import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { deferred, response, servers, wireSession } from '../../auth/__tests__/support';
import { AssetRepo } from '../../db/assetRepo';
import { serverKey } from '../../db/kv';
import type { HttpResponse } from '../../platform/http';
import { ReplicaProvider } from '../../replica/useReplica';
import { syncContext, type SyncContext } from '../../sync/__tests__/support';
import { createEngine } from '../../sync/engine';
import { createPull } from '../../sync/pull';
import type { Socket } from '../../sync/socket';
import { fakeFileSystem, type FakeFileSystem } from '../../testing/fakeFileSystem';
import { createAssetFiles, type AssetFiles, type Capture } from '../files';
import { AssetFilesProvider, useAssetFile } from '../useAssetFile';

const documentDirectory = 'file:///fake/documents/';
const capturedUri = `${documentDirectory}assets/fake-capture.jpg`;
const sha256 = 'a'.repeat(64);
let c: SyncContext;
let fileSystem: FakeFileSystem;
let files: AssetFiles;
let repo: AssetRepo;

function makeFiles(context = c): AssetFiles {
  return createAssetFiles({
    driver: context.driver, store: context.store, clock: context.clock,
    random: context.random, session: context.session, servers,
    activeServer: () => 'primary', fileSystem, documentDirectory,
  });
}

function seedUpload(overrides: Parameters<SyncContext['factory']['assetFile']>[0] = {}): string {
  const row = c.factory.assetFile({ localUri: capturedUri, ...overrides });
  repo.upsert(row);
  fileSystem.write(row.localUri ?? capturedUri, new Uint8Array([1, 2, 3]));
  return row.id;
}

function capture(): Capture {
  fileSystem.write(capturedUri, new Uint8Array([1, 2, 3]));
  return { id: c.ids.uuid(), kind: 'task_proof', localUri: capturedUri, sha256 };
}

async function advance(milliseconds: number): Promise<void> {
  c.clock.advance(milliseconds);
  await jest.advanceTimersByTimeAsync(milliseconds);
}

beforeEach(async () => {
  jest.useFakeTimers();
  c = await syncContext(undefined, Array.from({ length: 32 }, () => 0));
  fileSystem = fakeFileSystem();
  repo = new AssetRepo(c.driver);
  files = makeFiles();
});

afterEach(() => {
  files.uploads.dispose();
  c.driver.close();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('AF-1: the completion commits to the replica and outbox before its photo upload', async () => {
  const photo = capture();
  const task = c.factory.task_templates({ id: c.factory.taskId, requires_photo: true });
  c.apply.applyServerRows([{ entity: 'task_templates', row: task }]);
  let completionId = '';
  fileSystem.enqueue(() => {
    expect(c.replica.get('task_completions', completionId)?.row.photo_asset_id).toBe(photo.id);
    expect(c.store.getState().completions[completionId]?.photo_asset_id).toBe(photo.id);
    expect(c.outbox.hasEntryFor('task_completions', completionId)).toBe(true);
    return response(201, c.factory.assets({ id: photo.id }));
  });
  c.driver.transaction(() => {
    files.registerCapture(photo);
    completionId = c.mutations.createCompletion({
      task_id: task.id, occurrence_key: '2026-10-13T08:00', pet_id: null,
      completed_at: new Date(c.clock.now()).toISOString(), photo_asset_id: photo.id, note: null,
    });
    expect(fileSystem.requests).toHaveLength(0);
    expect(c.store.getState().completions[completionId]).toBeUndefined();
  });
  expect(c.store.getState().completions[completionId]?.photo_asset_id).toBe(photo.id);
  expect(c.outbox.count()).toBe(1);
  await files.uploads.kick();
  expect(fileSystem.requests).toHaveLength(1);
  expect(repo.get(photo.id)?.state).toBe('uploaded');
});

test('AF-1 rollback: capture does not upload if the enclosing transaction rolls back', async () => {
  const photo = capture();
  expect(() => c.driver.transaction(() => {
    files.registerCapture(photo);
    throw new Error('Injected rollback');
  })).toThrow('Injected rollback');
  await advance(0);
  expect(repo.get(photo.id)).toBeNull();
  expect(fileSystem.requests).toHaveLength(0);
});

test('AF-2: a durable to_upload file uploads after a simulated restart', async () => {
  const id = seedUpload();
  const snapshot = c.driver.export();
  files.uploads.dispose();
  const restarted = await syncContext(snapshot, [0]);
  const resumed = makeFiles(restarted);
  try {
    fileSystem.enqueue(response(201));
    await resumed.uploads.kick();
    expect(new AssetRepo(restarted.driver).get(id)?.state).toBe('uploaded');
    expect(fileSystem.requests).toHaveLength(1);
    expect(fileSystem.requests[0]?.url).toBe(`${servers.primary}/assets/${id}?kind=task_proof`);
  } finally {
    resumed.uploads.dispose();
    restarted.driver.close();
  }
});

test('AF-3: an upload retries on its own timer while the outbox remains empty', async () => {
  const id = seedUpload();
  const initial = c.clock.now();
  fileSystem.enqueue(new Error('Simulated offline transfer'), response(201));
  await files.uploads.kick();
  expect(c.outbox.count()).toBe(0);
  expect(repo.get(id)).toMatchObject({ state: 'to_upload', attempts: 1, nextRetryAt: initial + 1_000 });
  await advance(999);
  expect(fileSystem.requests).toHaveLength(1);
  await advance(1);
  expect(fileSystem.requests).toHaveLength(2);
  expect(repo.get(id)?.state).toBe('uploaded');
  expect(c.http.requests).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('AF-3: the retry timer sends the earliest file and rearms for the later deadline', async () => {
  const initial = c.clock.now();
  const later = seedUpload({ attempts: 1, createdAt: initial - 1 });
  const earlier = seedUpload({ createdAt: initial });
  const laterUrl = `${servers.primary}/assets/${later}?kind=task_proof`;
  const earlierUrl = `${servers.primary}/assets/${earlier}?kind=task_proof`;
  fileSystem.enqueue(response(500), response(500), response(201), response(201));
  await files.uploads.kick();
  expect(repo.get(later)).toMatchObject({
    state: 'to_upload', attempts: 2, nextRetryAt: initial + 2_000,
  });
  expect(repo.get(earlier)).toMatchObject({
    state: 'to_upload', attempts: 1, nextRetryAt: initial + 1_000,
  });
  expect(fileSystem.requests.map((request) => request.url)).toEqual([laterUrl, earlierUrl]);
  expect(c.outbox.count()).toBe(0);
  expect(jest.getTimerCount()).toBe(1);

  await advance(999);
  expect(fileSystem.requests).toHaveLength(2);
  await advance(1);
  expect(fileSystem.requests.map((request) => request.url)).toEqual([
    laterUrl, earlierUrl, earlierUrl,
  ]);
  expect(repo.get(earlier)?.state).toBe('uploaded');
  expect(repo.get(later)).toMatchObject({
    state: 'to_upload', attempts: 2, nextRetryAt: initial + 2_000,
  });
  expect(jest.getTimerCount()).toBe(1);

  await advance(999);
  expect(fileSystem.requests).toHaveLength(3);
  await advance(1);
  expect(fileSystem.requests.map((request) => request.url)).toEqual([
    laterUrl, earlierUrl, earlierUrl, laterUrl,
  ]);
  expect(repo.get(later)?.state).toBe('uploaded');
  expect(c.outbox.count()).toBe(0);
  expect(c.http.requests).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('AF-4: a real sync cycle completes while a photo upload promise is pending', async () => {
  const id = seedUpload();
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise);
  const upload = files.uploads.kick().then(() => null, (error: unknown) => error);
  await advance(0);
  expect(fileSystem.requests).toHaveLength(1);
  expect(repo.get(id)?.state).toBe('to_upload');
  const pet = c.factory.pets({ revision: 2 });
  c.kv.set(serverKey('reseeded_epoch', 'primary'), 'fake-epoch');
  c.http.enqueue(response(200, {
    changes: [{ entity: 'pets', row: pet }], revision: 2, has_more: false, epoch: 'fake-epoch',
  }));
  const arrive = jest.fn(async () => 'ok' as const);
  const socket: Socket = {
    state: 'closed', connect: async () => {}, close() {},
  };
  const engine = createEngine({
    driver: c.driver, session: c.session, clock: c.clock, random: c.random,
    serverSelect: { current: () => 'primary' }, arrive, outbox: c.drain,
    pull: createPull({ driver: c.driver, apply: c.apply, api: c.api, arrive }),
    createSocket: () => socket, online: true, foreground: false,
  });
  try {
    await engine.kick('start');
    expect(engine.state.getState().status).toBe('synced');
    expect(c.store.getState().pets[pet.id]).toEqual(pet);
    expect(repo.get(id)?.state).toBe('to_upload');
    pending.resolve(response(201));
    expect(await upload).toBeNull();
    expect(repo.get(id)?.state).toBe('uploaded');
  } finally {
    engine.dispose();
    pending.resolve(response(201));
  }
});

test.each([200, 201])('upload success %i: persist uploaded and send the id, kind and hash', async (status) => {
  const id = seedUpload();
  fileSystem.enqueue(response(status));
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('uploaded');
  expect(fileSystem.requests).toEqual([{
    method: 'PUT', url: `${servers.primary}/assets/${id}?kind=task_proof`, uri: capturedUri,
    headers: expect.objectContaining({
      Authorization: 'Bearer fake-primary-access-initial',
      'X-Content-SHA256': sha256, 'Content-Length': '3',
    }),
  }]);
  expect(c.http.requests).toHaveLength(0);
});

test.each([408, 425, 429, 500, 503])('transient upload %i: retain the file and schedule backoff', async (status) => {
  const id = seedUpload();
  fileSystem.enqueue(response(status));
  await files.uploads.kick();
  expect(repo.get(id)).toMatchObject({
    state: 'to_upload', attempts: 1, nextRetryAt: c.clock.now() + 1_000,
  });
  expect(await fileSystem.exists(capturedUri)).toBe(true);
  expect(jest.getTimerCount()).toBe(1);
});

test.each([429, 503])('transient upload %i: honour Retry-After', async (status) => {
  const id = seedUpload();
  fileSystem.enqueue({ ...response(status), headers: { 'Retry-After': '7' } });
  await files.uploads.kick();
  expect(repo.get(id)?.nextRetryAt).toBe(c.clock.now() + 7_000);
});

test.each([400, 403, 404, 409, 410, 413, 422])('permanent upload %i: mark failed and do not retry automatically', async (status) => {
  const id = seedUpload();
  fileSystem.enqueue(response(status));
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('failed');
  expect(jest.getTimerCount()).toBe(0);
  await advance(120_000);
  expect(fileSystem.requests).toHaveLength(1);
  expect(await fileSystem.exists(capturedUri)).toBe(true);
});

test('upload single-flight: simultaneous kicks send one file once', async () => {
  const id = seedUpload();
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise);
  const first = files.uploads.kick();
  const firstResult = first.then(() => null, (error: unknown) => error);
  const second = files.uploads.kick();
  const secondResult = second.then(() => null, (error: unknown) => error);
  await advance(0);
  expect(fileSystem.requests).toHaveLength(1);
  pending.resolve(response(201));
  expect(await firstResult).toBeNull();
  expect(await secondResult).toBeNull();
  expect(repo.get(id)?.state).toBe('uploaded');
  expect(fileSystem.requests).toHaveLength(1);
});

test('upload ordering: due rows upload oldest first and future rows wait', async () => {
  const newer = seedUpload({ createdAt: c.clock.now() + 1 });
  const oldest = seedUpload({ createdAt: c.clock.now() - 1 });
  const future = seedUpload({ nextRetryAt: c.clock.now() + 5_000 });
  fileSystem.enqueue(response(201), response(201), response(201));
  await files.uploads.kick();
  expect(fileSystem.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/assets/${oldest}?kind=task_proof`,
    `${servers.primary}/assets/${newer}?kind=task_proof`,
  ]);
  await advance(5_000);
  expect(repo.get(future)?.state).toBe('uploaded');
});

test('retryUpload: reset attempts and retry a refused photo immediately', async () => {
  const id = seedUpload({ state: 'failed', attempts: 4, nextRetryAt: c.clock.now() + 60_000 });
  fileSystem.enqueue(response(201));
  files.retryUpload(id);
  expect(repo.get(id)).toMatchObject({ state: 'to_upload', attempts: 0, nextRetryAt: 0 });
  await files.uploads.kick();
  expect(fileSystem.requests).toHaveLength(1);
  expect(repo.get(id)?.state).toBe('uploaded');
});

test('registerCapture: persist the supplied local file and kick uploads', async () => {
  const photo = capture();
  const createdAt = c.clock.now();
  fileSystem.enqueue(response(201));
  files.registerCapture(photo);
  expect(repo.get(photo.id)).toEqual({
    ...photo, state: 'to_upload', attempts: 0, nextRetryAt: 0, createdAt,
  });
  await advance(0);
  expect(fileSystem.requests).toHaveLength(1);
  expect(repo.get(photo.id)?.state).toBe('uploaded');
});

test('ensureFile pending: an absent replica asset makes no download request', async () => {
  expect(await files.ensureFile(c.ids.uuid())).toEqual({ status: 'pending' });
  expect(fileSystem.requests).toHaveLength(0);
  expect(repo.list()).toHaveLength(0);
});

test.each([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
])('ensureFile once and cached: %s downloads into app storage and is reused', async (mime, extension) => {
  const asset = c.factory.assets({ mime });
  c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
  const uri = `${documentDirectory}assets/${asset.id}.${extension}`;
  fileSystem.enqueue(response(200, new Uint8Array([4, 5, 6])));
  expect(await files.ensureFile(asset.id)).toEqual({ status: 'ready', uri });
  expect(repo.get(asset.id)).toMatchObject({ id: asset.id, kind: asset.kind, localUri: uri, state: 'downloaded' });
  expect(fileSystem.requests).toEqual([{
    method: 'GET', url: `${servers.primary}/assets/${asset.id}/file`, uri,
    headers: { Authorization: 'Bearer fake-primary-access-initial' },
  }]);
  expect(await files.ensureFile(asset.id)).toEqual({ status: 'ready', uri });
  expect(fileSystem.requests).toHaveLength(1);
});

test('ensureFile local capture: ready before the replica asset arrives', async () => {
  const id = seedUpload();
  expect(c.store.getState().assets[id]).toBeUndefined();
  expect(await files.ensureFile(id)).toEqual({ status: 'ready', uri: capturedUri });
  expect(fileSystem.requests).toHaveLength(0);
});

test('ensureFile missing cached bytes: download the replica asset again', async () => {
  const asset = c.factory.assets();
  c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
  repo.upsert(c.factory.assetFile({ id: asset.id, state: 'downloaded', localUri: capturedUri }));
  fileSystem.enqueue(response(200));
  expect(await files.ensureFile(asset.id)).toEqual({
    status: 'ready', uri: `${documentDirectory}assets/${asset.id}.jpg`,
  });
  expect(fileSystem.requests).toHaveLength(1);
});

test.each([new Error('Simulated offline download'), response(404), response(503)])(
  'ensureFile failed: a failed transfer returns failed without a cached row (%#)', async (reply) => {
    const asset = c.factory.assets();
    c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
    fileSystem.enqueue(reply);
    expect(await files.ensureFile(asset.id)).toEqual({ status: 'failed' });
    expect(repo.get(asset.id)).toBeNull();
  },
);

test('prefetchAvatars: eagerly download only avatars of non-archived pets', async () => {
  const active = c.factory.assets({ kind: 'pet_avatar' });
  const archived = c.factory.assets({ kind: 'pet_avatar' });
  const proof = c.factory.assets({ kind: 'task_proof' });
  const attachment = c.factory.assets({ kind: 'health_attachment' });
  c.apply.applyServerRows([
    { entity: 'assets', row: active }, { entity: 'assets', row: archived },
    { entity: 'assets', row: proof }, { entity: 'assets', row: attachment },
    { entity: 'pets', row: c.factory.pets({ avatar_asset_id: active.id }) },
    { entity: 'pets', row: c.factory.pets({ avatar_asset_id: active.id }) },
    { entity: 'pets', row: c.factory.pets({ avatar_asset_id: archived.id,
      archived_at: new Date(c.clock.now()).toISOString() }) },
    { entity: 'pets', row: c.factory.pets() },
  ]);
  fileSystem.enqueue(response(200));
  await files.prefetchAvatars();
  expect(fileSystem.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/assets/${active.id}/file`,
  ]);
  expect(repo.get(archived.id)).toBeNull();
  expect(repo.get(proof.id)).toBeNull();
  expect(repo.get(attachment.id)).toBeNull();
});

test('useAssetFile: re-evaluate a pending file when its replica asset arrives', async () => {
  const asset = c.factory.assets();
  function Wrapper({ children }: { children: ReactNode }) {
    const props = { store: c.store, children: createElement(AssetFilesProvider, { files }, children) };
    return createElement(ReplicaProvider, props);
  }
  const rendered = await renderHook(() => useAssetFile(asset.id), { wrapper: Wrapper });
  try {
    expect(rendered.result.current).toEqual({ status: 'pending' });
    expect(fileSystem.requests).toHaveLength(0);
    fileSystem.enqueue(response(200));
    await act(async () => {
      c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
      await advance(0);
    });
    expect(rendered.result.current).toEqual({
      status: 'ready', uri: `${documentDirectory}assets/${asset.id}.jpg`,
    });
    expect(fileSystem.requests).toHaveLength(1);
  } finally {
    await rendered.unmount();
  }
});

test('fakeFileSystem: scripted downloads cache bytes and removal clears them', async () => {
  const fake = fakeFileSystem(response(200, new Uint8Array([7, 8])));
  const uri = 'file:///fake/download.jpg';
  expect(await fake.exists(uri)).toBe(false);
  await fake.download('https://files.invalid/photo', uri, {});
  expect(fake.read(uri)).toEqual(new Uint8Array([7, 8]));
  expect(await fake.exists(uri)).toBe(true);
  await fake.remove(uri);
  expect(await fake.exists(uri)).toBe(false);
  expect(fake.read(uri)).toBeNull();
  expect(fake.removed).toEqual([uri]);
});

test('fakeFileSystem: failed downloads store no bytes and upload uses the file length', async () => {
  const fake = fakeFileSystem(response(404), response(201));
  const uri = 'file:///fake/upload.jpg';
  await fake.download('https://files.invalid/photo', uri, {});
  expect(await fake.exists(uri)).toBe(false);
  fake.write(uri, new Uint8Array([1, 2, 3]));
  await fake.upload('https://files.invalid/photo', uri, { 'X-Content-SHA256': sha256 });
  expect(fake.requests[1]).toMatchObject({ method: 'PUT', uri, headers: { 'Content-Length': '3' } });
});

test('upload auth refresh: retry the same id and hash once with the rotated access token', async () => {
  const id = seedUpload();
  fileSystem.enqueue(response(401), response(201));
  c.http.enqueue(response(200, wireSession('primary', 'rotated')));
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('uploaded');
  expect(fileSystem.requests.map((request) => request.headers.Authorization)).toEqual([
    'Bearer fake-primary-access-initial', 'Bearer fake-primary-access-rotated',
  ]);
  expect(fileSystem.requests.map((request) => request.headers['X-Content-SHA256'])).toEqual([sha256, sha256]);
  expect(new Set(fileSystem.requests.map((request) => request.url)).size).toBe(1);
  expect(c.http.requests.map((request) => request.url)).toEqual([`${servers.primary}/auth/refresh`]);
});

test('upload auth expiry: keep the queued photo without an automatic retry loop', async () => {
  const id = seedUpload();
  fileSystem.enqueue(response(401));
  c.http.enqueue(response(401));
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('to_upload');
  expect(c.kv.get('signed_out.primary')).toBe('1');
  expect(jest.getTimerCount()).toBe(0);
  await c.session.adopt(wireSession('primary', 'new-login'));
  fileSystem.enqueue(response(201));
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('uploaded');
});

test('upload missing session: keep the file and make no transfer request or retry timer', async () => {
  const id = seedUpload();
  await c.session.clear();
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('to_upload');
  expect(fileSystem.requests).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('upload refresh offline: use upload backoff after refresh fails on the network', async () => {
  const id = seedUpload();
  fileSystem.enqueue(response(401));
  c.http.enqueue(new Error('Simulated refresh network failure'));
  await files.uploads.kick();
  expect(repo.get(id)).toMatchObject({ state: 'to_upload', attempts: 1,
    nextRetryAt: c.clock.now() + 1_000 });
  expect(c.kv.get('signed_out.primary')).toBeNull();
});

test.each(['future', 'past', 'invalid'])('upload Retry-After %s: parse HTTP dates with the injected clock', async (value) => {
  const id = seedUpload();
  const deadline = value === 'future' ? c.clock.now() + 10_000 : c.clock.now() - 10_000;
  const header = value === 'invalid' ? 'invalid-date' : new Date(deadline).toUTCString();
  fileSystem.enqueue({ ...response(503), headers: { 'retry-after': header } });
  await files.uploads.kick();
  expect(repo.get(id)?.nextRetryAt).toBe(c.clock.now()
    + (value === 'future' ? 10_000 : value === 'past' ? 0 : 1_000));
});

test('upload disposal: a pending transfer cannot write metadata or install another timer', async () => {
  const id = seedUpload();
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise);
  const running = files.uploads.kick();
  await advance(0);
  files.uploads.dispose();
  pending.resolve(response(201));
  await running;
  await files.uploads.kick();
  expect(repo.get(id)?.state).toBe('to_upload');
  expect(fileSystem.requests).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('upload disposal before run: a disposed loop makes no request', async () => {
  seedUpload();
  const running = files.uploads.kick();
  files.uploads.dispose();
  await running;
  expect(fileSystem.requests).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('upload capture during flight: the next photo drains after the pending photo', async () => {
  const firstId = seedUpload();
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise, response(201));
  const running = files.uploads.kick();
  await advance(0);
  const next = capture();
  files.registerCapture(next);
  pending.resolve(response(201));
  await running;
  expect(repo.get(firstId)?.state).toBe('uploaded');
  expect(repo.get(next.id)?.state).toBe('uploaded');
  expect(fileSystem.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/assets/${firstId}?kind=task_proof`,
    `${servers.primary}/assets/${next.id}?kind=task_proof`,
  ]);
});

test.each(['localUri', 'sha256'] as const)('upload missing %s: fail incomplete metadata and continue the queue', async (field) => {
  const missing = seedUpload({ [field]: null });
  const valid = seedUpload();
  fileSystem.enqueue(response(201));
  await files.uploads.kick();
  expect(repo.get(missing)?.state).toBe('failed');
  expect(repo.get(valid)?.state).toBe('uploaded');
  expect(fileSystem.requests).toHaveLength(1);
});

test('retryUpload: missing and already uploaded ids make no transfer', async () => {
  const uploaded = seedUpload({ state: 'uploaded' });
  files.retryUpload(c.ids.uuid());
  files.retryUpload(uploaded);
  await advance(0);
  expect(repo.get(uploaded)?.state).toBe('uploaded');
  expect(fileSystem.requests).toHaveLength(0);
});

test('ensureFile single-flight: simultaneous consumers share one download', async () => {
  const asset = c.factory.assets();
  c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise);
  const first = files.ensureFile(asset.id);
  const second = files.ensureFile(asset.id);
  await advance(0);
  expect(fileSystem.requests).toHaveLength(1);
  pending.resolve(response(200));
  const expected = { status: 'ready', uri: `${documentDirectory}assets/${asset.id}.jpg` };
  expect(await first).toEqual(expected);
  expect(await second).toEqual(expected);
  expect(await files.ensureFile(asset.id)).toEqual(expected);
  expect(fileSystem.requests).toHaveLength(1);
});

test('ensureFile unavailable metadata: an unknown MIME makes no download request', async () => {
  const asset = c.factory.assets({ mime: 'invalid/type' });
  c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
  expect(await files.ensureFile(asset.id)).toEqual({ status: 'failed' });
  expect(fileSystem.requests).toHaveLength(0);
});

test('ensureFile null local URI: download a replica asset with incomplete local metadata', async () => {
  const asset = c.factory.assets();
  c.apply.applyServerRows([{ entity: 'assets', row: asset }]);
  repo.upsert(c.factory.assetFile({ id: asset.id, localUri: null, state: 'downloaded' }));
  fileSystem.enqueue(response(200));
  expect(await files.ensureFile(asset.id)).toEqual({
    status: 'ready', uri: `${documentDirectory}assets/${asset.id}.jpg`,
  });
});

test('useAssetFile missing provider: report the missing file service', async () => {
  await expect(renderHook(() => useAssetFile(c.ids.uuid())))
    .rejects.toThrow('useAssetFile requires an AssetFilesProvider');
});

test('useAssetFile changed id: ignore the old pending download and render the new file', async () => {
  const first = c.factory.assets();
  const next = c.factory.assets();
  c.apply.applyServerRows([{ entity: 'assets', row: first }, { entity: 'assets', row: next }]);
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise, response(200));
  function Wrapper({ children }: { children: ReactNode }) {
    const props = { store: c.store, children: createElement(AssetFilesProvider, { files }, children) };
    return createElement(ReplicaProvider, props);
  }
  const rendered = await renderHook(({ id }: { id: string }) => useAssetFile(id), {
    initialProps: { id: first.id }, wrapper: Wrapper,
  });
  try {
    await rendered.rerender({ id: next.id });
    expect(rendered.result.current).toEqual({ status: 'ready', uri: `${documentDirectory}assets/${next.id}.jpg` });
    await act(async () => { pending.resolve(response(200)); });
    expect(rendered.result.current).toEqual({ status: 'ready', uri: `${documentDirectory}assets/${next.id}.jpg` });
  } finally {
    pending.resolve(response(200));
    await rendered.unmount();
  }
});
