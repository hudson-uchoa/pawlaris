import { fakeNotifications } from '../testing/fakeNotifications';
import { useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { AppState, Text, useColorScheme, type AppStateStatus } from 'react-native';
import { AppProvider, useApp, type AppContext } from '../appContext';
import { createAppRuntime, type AppDependencies, type AppRuntime } from '../bootstrap';
import { epoch, response, servers, wireSession } from '../auth/__tests__/support';
import { Kv, serverKey, type Server } from '../db/kv';
import { openDatabase } from '../db/open';
import { AssetRepo } from '../db/assetRepo';
import { OutboxRepo } from '../db/outboxRepo';
import { ReplicaRepo } from '../db/replicaRepo';
import { createReplicaApply } from '../replica/apply';
import { useReplica } from '../replica/useReplica';
import { fakeClock } from '../testing/fakeClock';
import { fakeFileSystem } from '../testing/fakeFileSystem';
import { fakeHttp } from '../testing/fakeHttp';
import { fakeLogFiles } from '../testing/fakeLogFiles';
import { fakeRandom } from '../testing/fakeRandom';
import { fakeSecretBox } from '../testing/fakeSecretBox';
import { fakeWebSocket } from '../testing/fakeWebSocket';
import { memoryDriver } from '../testing/memoryDriver';
import { rowFactories } from '../testing/rowFactories';
import { sequentialIds } from '../testing/sequentialIds';

jest.mock('react-native/Libraries/Utilities/useColorScheme');
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: jest.fn() },
  NetInfoStateType: { other: 'other' },
}));

const syncEpoch = '00000000-0000-4000-8000-000000000031';
const initialAppState = AppState.currentState;
let c: Awaited<ReturnType<typeof context>>;
let runtime: AppRuntime | undefined;
let networkListener: Parameters<typeof NetInfo.addEventListener>[0] | undefined;
let appListener: ((state: AppStateStatus) => void) | undefined;
let initiallyOnline = true;
const removeNetwork = jest.fn();
const removeAppState = jest.fn();

async function context() {
  const driver = await memoryDriver();
  const clock = fakeClock(epoch);
  const ids = sequentialIds();
  const http = fakeHttp();
  const secretBox = fakeSecretBox();
  const socket = fakeWebSocket();
  const perfOutput = jest.fn();
  const fileSystem = fakeFileSystem();
  const logFiles = fakeLogFiles();
  const notifications = fakeNotifications();
  notifications.setPermission(true);
  const deps = {
    notifications: notifications.platform,
    driver, clock, ids, http, secretBox, servers, perfOutput, online: true,
    random: fakeRandom(...Array.from({ length: 20 }, () => 0.5)),
    fileSystem, logFiles, documentDirectory: 'file:///fake/documents/', WebSocketImpl: socket.WebSocketImpl,
  } satisfies AppDependencies;
  return { deps, driver, clock, http, secretBox, socket, perfOutput, fileSystem, logFiles,
    factory: rowFactories(clock, ids), kv: new Kv(driver),
    replica: new ReplicaRepo(driver), outbox: new OutboxRepo(driver),
  };
}

beforeEach(async () => {
  jest.useFakeTimers({ now: epoch });
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  networkListener = undefined;
  appListener = undefined;
  initiallyOnline = true;
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    networkListener = listener;
    if (initiallyOnline) listener({ type: NetInfoStateType.other, isConnected: true, isInternetReachable: true,
      details: { isConnectionExpensive: false } });
    return removeNetwork;
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appListener = listener as (state: AppStateStatus) => void;
    return { remove: removeAppState };
  });
  c = await context();
});

afterEach(async () => {
  await cleanup();
  runtime?.dispose();
  runtime = undefined;
  c.driver.close();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function seedSession(server: Server = 'primary', arrived = true) {
  openDatabase(c.driver);
  const wire = wireSession(server);
  c.kv.set('session_user', JSON.stringify(wire.user));
  c.kv.set('active_server', server);
  if (arrived) c.kv.set(serverKey('reseeded_epoch', server), syncEpoch);
  await c.secretBox.set(`session_tokens.${server}`, JSON.stringify(wire));
  return wire;
}

function page(revision = 7) {
  return response(200, { changes: [], revision, has_more: false, epoch: syncEpoch });
}

async function flush() {
  await jest.advanceTimersByTimeAsync(0);
}

test('R5.1 bootstrap migrates an empty database and performs no I/O before paint', async () => {
  runtime = createAppRuntime(c.deps);
  expect(c.driver.all<{ user_version: number }>('PRAGMA user_version')[0]?.user_version).toBeGreaterThan(0);
  expect(runtime.sessionUser()).toBeNull();
  expect(runtime.engine.state.getState().status).toBe('signed_out');
  expect(runtime.store.getState().ready).toBe(false);
  await flush();
  expect(c.http.requests).toHaveLength(0);
  expect(c.socket.instances).toHaveLength(0);
  expect(NetInfo.addEventListener).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  expect(c.perfOutput).not.toHaveBeenCalled();
});

test('R5.1 bootstrap hydrates the replica synchronously without refreshing a session', async () => {
  const wire = await seedSession();
  const pet = c.factory.pets();
  c.replica.upsert('family', c.factory.family(), { pending: false, deleted: false, pullGen: 0 });
  c.replica.upsert('pets', pet, { pending: true, deleted: false, pullGen: 0 });
  runtime = createAppRuntime(c.deps);
  expect(runtime.db).toBe(c.driver);
  expect(runtime.clock).toBe(c.clock);
  expect(runtime.sessionUser()).toEqual(wire.user);
  expect(runtime.store.getState().ready).toBe(true);
  expect(runtime.store.getState().pets[pet.id]).toEqual(pet);
  expect(runtime.store.getState().pending[`pets:${pet.id}`]).toBe(true);
  await flush();
  expect(c.http.requests).toHaveLength(0);
  expect(c.socket.instances).toHaveLength(0);
});

test.each(['primary', 'reserve'] as const)('SE-2 bootstrap preserves signed-out %s rows and outbox', async (server) => {
  await seedSession(server);
  c.kv.set(serverKey('signed_out', server), '1');
  const pet = c.factory.pets({ revision: null });
  c.replica.upsert('pets', pet, { pending: true, deleted: false, pullGen: 0 });
  c.outbox.insert(c.factory.outbox({ entityId: pet.id }));
  const rows = c.driver.all('SELECT * FROM replica');
  const outbox = c.driver.all('SELECT * FROM outbox');
  runtime = createAppRuntime(c.deps);
  expect(runtime.engine.state.getState()).toMatchObject({ status: 'signed_out', server });
  expect(c.driver.all('SELECT * FROM replica')).toEqual(rows);
  expect(c.driver.all('SELECT * FROM outbox')).toEqual(outbox);
  await flush();
  expect(c.http.requests).toHaveLength(0);
});

test.each(['primary', 'reserve'] as const)('SE-4 first paint starts one real cycle on %s with its stored token', async (server) => {
  const wire = await seedSession(server);
  runtime = createAppRuntime(c.deps);
  c.http.enqueue(page());
  expect(c.http.requests).toHaveLength(0);
  runtime.afterFirstPaint();
  runtime.afterFirstPaint();
  await flush();
  expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]).toMatchObject({ url: `${servers[server]}/sync?since=0&limit=500`,
    headers: { Authorization: `Bearer ${wire.access_token}` } });
  expect(c.socket.instances[0]?.url).toBe(`${servers[server].replace(/^https:/, 'wss:')}/ws`);
  c.socket.instances[0]?.open();
  expect(c.socket.instances[0]?.sent.map((frame): unknown => JSON.parse(frame))).toEqual([
    { type: 'auth', access_token: wire.access_token },
  ]);
  expect(runtime.engine.state.getState()).toMatchObject({ status: 'synced', server });
  expect(c.perfOutput).not.toHaveBeenCalled();
});

test('bootstrap wires arrival through its epoch read and full pull after first paint', async () => {
  await seedSession('primary', false);
  runtime = createAppRuntime(c.deps);
  c.http.enqueue(page(), page(), page());
  runtime.afterFirstPaint();
  await flush();
  expect(c.http.requests.map(({ url }) => url)).toEqual([
    `${servers.primary}/sync?since=0&limit=1`,
    `${servers.primary}/sync?since=0&limit=500`,
    `${servers.primary}/sync?since=7&limit=500`,
  ]);
  expect(c.kv.get('reseeded_epoch.primary')).toBe(syncEpoch);
  expect(runtime.engine.state.getState().status).toBe('synced');
});

test('OB-2 bootstrap drains the outbox through the real event bus before pulling', async () => {
  const wire = await seedSession();
  const pet = c.factory.pets({ revision: null });
  c.replica.upsert('pets', pet, { pending: true, deleted: false, pullGen: 0 });
  const entry = c.outbox.insert(c.factory.outbox({ userId: wire.user.id, entityId: pet.id }));
  runtime = createAppRuntime(c.deps);
  const rejected = jest.fn();
  runtime.events.on('mutation_rejected', rejected);
  c.http.enqueue(response(422, { code: 'validation_error' }), page());
  runtime.afterFirstPaint();
  await flush();
  expect(c.http.requests.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: entry.method, url: `${servers.primary}${entry.path}` },
    { method: 'GET', url: `${servers.primary}/sync?since=0&limit=500` },
  ]);
  expect(c.http.requests[0]?.headers?.['Idempotency-Key']).toBe(entry.clientMutationId);
  expect(rejected).toHaveBeenCalledTimes(1);
  expect(rejected).toHaveBeenCalledWith({ entry });
  expect(c.outbox.count()).toBe(0);
  expect(c.driver.all('SELECT * FROM dead_letter')).toHaveLength(1);
  expect(runtime.engine.state.getState().status).toBe('synced');
});

test('bootstrap feeds connectivity and foreground changes and removes subscriptions on disposal', async () => {
  await seedSession();
  initiallyOnline = false;
  runtime = createAppRuntime({ ...c.deps, online: false });
  runtime.afterFirstPaint();
  await flush();
  expect(c.http.requests).toHaveLength(0);
  c.http.enqueue(page());
  networkListener?.({ type: NetInfoStateType.other, isConnected: true, isInternetReachable: true,
    details: { isConnectionExpensive: false } });
  await flush();
  expect(c.http.requests).toHaveLength(1);
  expect(runtime.engine.state.getState().status).toBe('synced');
  appListener?.('background');
  expect(c.socket.instances[0]?.closes).toHaveLength(1);
  c.http.enqueue(page(8));
  appListener?.('active');
  await flush();
  expect(c.http.requests).toHaveLength(2);
  runtime.dispose();
  runtime.dispose();
  expect(removeNetwork).toHaveBeenCalledTimes(1);
  expect(removeAppState).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  appListener?.('active');
  networkListener?.({ type: NetInfoStateType.other, isConnected: true, isInternetReachable: true,
    details: { isConnectionExpensive: false } });
  await flush();
  expect(c.http.requests).toHaveLength(2);
});

test('bootstrap disposed before paint never starts sync or lifecycle listeners', async () => {
  await seedSession();
  runtime = createAppRuntime(c.deps);
  runtime.dispose();
  runtime.afterFirstPaint();
  await flush();
  expect(c.http.requests).toHaveLength(0);
  expect(NetInfo.addEventListener).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
});

test('SE-3 runtime lifecycle wipes previous data and the asset directory before adopting another user', async () => {
  await seedSession();
  const pet = c.factory.pets({ revision: null });
  c.replica.upsert('pets', pet, { pending: true, deleted: false, pullGen: 0 });
  c.outbox.insert(c.factory.outbox({ userId: wireSession('primary').user.id, entityId: pet.id }));
  c.kv.set('device_id', '00000000-0000-4000-8000-000000000090');
  await c.secretBox.set('session_tokens.reserve', JSON.stringify(wireSession('reserve')));
  runtime = createAppRuntime(c.deps);
  const next = { ...wireSession('primary', 'different'), user: {
    ...wireSession('primary').user, id: '00000000-0000-4000-8000-000000000099', email: 'other@example.invalid',
  } };
  const confirmDiscard = jest.fn(async () => true);
  expect(await runtime.lifecycle.onLogin(next, { confirmDiscard })).toBe(true);
  await flush();
  expect(confirmDiscard).toHaveBeenCalledWith(1);
  expect(c.fileSystem.removed).toEqual([`${c.deps.documentDirectory}assets`]);
  expect(c.outbox.count()).toBe(0);
  expect(c.driver.all('SELECT * FROM replica')).toEqual([]);
  expect(runtime.sessionUser()).toEqual(next.user);
  expect(runtime.store.getState().pets).toEqual({});
  expect(c.secretBox.snapshot()['session_tokens.reserve']).toBeUndefined();
  expect(await runtime.session.accessToken('primary')).toBe(next.access_token);
  expect(c.kv.get('device_id')).toBe('00000000-0000-4000-8000-000000000090');
  expect(c.http.requests).toHaveLength(0);
});

test('AppProvider exposes the runtime and follows system theme without replacing it', async () => {
  await seedSession();
  const created = createAppRuntime(c.deps);
  runtime = created;
  const observe = jest.fn<void, [AppContext]>();
  function Probe() {
    const app = useApp();
    useEffect(() => { observe(app); }, [app]);
    const pets = useReplica((state) => Object.values(state.pets).map((pet) => pet.name).join(', '));
    return <Text testID="replica-probe">{pets}</Text>;
  }
  const view = await render(<AppProvider runtime={created}><Probe /></AppProvider>);
  expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ ...created,
    theme: expect.objectContaining({ scheme: 'dark' }),
  }));
  jest.mocked(useColorScheme).mockReturnValue('light');
  await view.rerender(<AppProvider runtime={created}><Probe /></AppProvider>);
  expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ ...created,
    theme: expect.objectContaining({ scheme: 'light' }),
  }));
  const pet = c.factory.pets({ name: 'New pet' });
  await act(() => {
    createReplicaApply({ driver: c.driver, store: created.store, clock: c.clock }).applyLocalRow('pets', pet);
  });
  expect(screen.getByTestId('replica-probe')).toHaveTextContent('New pet');
  expect(c.http.requests).toHaveLength(0);
});

test('useApp reports its missing provider', async () => {
  function Probe() { useApp(); return null; }
  await expect(render(<Probe />)).rejects.toThrow('useApp requires an AppProvider');
});

test('AF-2 bootstrap resumes durable uploads only after paint and disposes their retry loop', async () => {
  await seedSession();
  const file = c.factory.assetFile({ state: 'to_upload' });
  new AssetRepo(c.driver).upsert(file);
  if (file.localUri === null) throw new Error('Expected a captured file URI');
  c.fileSystem.write(file.localUri, new Uint8Array([1, 2, 3]));
  runtime = createAppRuntime(c.deps);
  await flush();
  expect(c.fileSystem.requests).toHaveLength(0);
  c.http.enqueue(page());
  c.fileSystem.enqueue(new Error('Simulated upload interruption'));
  runtime.afterFirstPaint();
  await flush();
  expect(c.fileSystem.requests).toHaveLength(1);
  expect(c.fileSystem.requests[0]).toMatchObject({ method: 'PUT',
    url: `${servers.primary}/assets/${file.id}?kind=${file.kind}` });
  expect(new AssetRepo(c.driver).get(file.id)?.attempts).toBe(1);
  runtime.dispose();
  expect(jest.getTimerCount()).toBe(0);
  c.clock.advance(2000);
  await jest.advanceTimersByTimeAsync(2000);
  expect(c.fileSystem.requests).toHaveLength(1);
});

test('AF-5 bootstrap prefetches a pet avatar after the real pull', async () => {
  await seedSession();
  const asset = c.factory.assets({ kind: 'pet_avatar', mime: 'image/jpeg' });
  const pet = c.factory.pets({ avatar_asset_id: asset.id });
  runtime = createAppRuntime(c.deps);
  c.http.enqueue(response(200, { changes: [
    { entity: 'assets', row: asset }, { entity: 'pets', row: pet },
  ], revision: 7, has_more: false, epoch: syncEpoch }));
  c.fileSystem.enqueue(response(200, new Uint8Array([1, 2, 3])));
  expect(c.fileSystem.requests).toHaveLength(0);
  runtime.afterFirstPaint();
  await flush();
  expect(c.fileSystem.requests).toHaveLength(1);
  expect(c.fileSystem.requests[0]).toMatchObject({ method: 'GET',
    url: `${servers.primary}/assets/${asset.id}/file`,
    uri: `${c.deps.documentDirectory}assets/${asset.id}.jpg`,
  });
  expect(new AssetRepo(c.driver).get(asset.id)?.state).toBe('downloaded');
});

test('RS-2 rejected reseed rows reach the file logger with identifiers only', async () => {
  await seedSession('primary', false);
  const pet = c.factory.pets({ name: 'Excluded row content', revision: 1 });
  c.replica.upsert('pets', pet, { pending: false, deleted: false, pullGen: 0 });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const read = jest.spyOn(c.logFiles, 'read');
  runtime = createAppRuntime(c.deps);
  await flush();
  expect(read).not.toHaveBeenCalled();
  expect(c.http.requests).toHaveLength(0);
  c.http.enqueue(page(), response(422, { detail: 'Excluded response body' }), page(), page());
  runtime.afterFirstPaint();
  await flush();
  const exported = await runtime.logger.exportText();
  expect(JSON.parse(exported) as unknown).toEqual({
    ts: new Date(c.clock.now()).toISOString(), level: 'warn', event: 'reseed_row_rejected',
    entity: 'pets', id: pet.id,
  });
  expect(exported).not.toContain(pet.name);
  expect(exported).not.toContain('Excluded response body');
  expect(exported).not.toContain(wireSession('primary').access_token);
  expect(exported).not.toContain(wireSession('primary').refresh_token);
  expect(warn).not.toHaveBeenCalled();
  expect(runtime.engine.state.getState().status).toBe('synced');
});
