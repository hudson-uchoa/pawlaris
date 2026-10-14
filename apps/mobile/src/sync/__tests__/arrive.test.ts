import type { Pet } from '@pawlaris/shared';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { deferred, response, servers, wireSession } from '../../auth/__tests__/support';
import { AssetRepo } from '../../db/assetRepo';
import { serverKey } from '../../db/kv';
import type { EntityRows, SyncEntity } from '../../db/replicaRepo';
import { WalkRepo, type RoutePoint } from '../../db/walkRepo';
import type { HttpRequest, HttpResponse } from '../../platform/http';
import type { ServerChange } from '../../replica/apply';
import { fakeFileSystem } from '../../testing/fakeFileSystem';
import { fakeRandom } from '../../testing/fakeRandom';
import { createArrive, type Arrive } from '../arrive';
import { createEngine, type Engine } from '../engine';
import type { PetCreate, WalkFinish } from '../mutations';
import { createPull, type Pull } from '../pull';
import { createSyncEngine } from '../wiring';
import { syncContext, type SyncContext } from './support';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: jest.fn() },
  NetInfoStateType: { other: 'other' },
}));

type ReseedRow = ServerChange | {
  entity: 'walk_routes'; row: { walk_id: string; points: RoutePoint[] };
};
type Page = { changes: ServerChange[]; revision: number; has_more: boolean; epoch: string };
const syncEpoch = '00000000-0000-4000-8000-000000000041';
const previousEpoch = '00000000-0000-4000-8000-000000000040';
const key = (entity: string, id: string): string => `${entity}:${id}`;
const rowKey = (change: ReseedRow): string => key(change.entity,
  change.entity === 'walk_routes' ? change.row.walk_id : change.row.id);

// Only merge behavior exercised here is modeled; the server's vector suite
// owns completion races and the rest of the POST /reseed contract.
function fakeServer(clock: { now(): number }) {
  const rows = new Map<string, ServerChange>();
  const routes = new Map<string, RoutePoint[]>();
  const batches: ReseedRow[][] = [];
  const pages: Page[] = [];
  const refused = new Set<string>();
  const invalid = new Set<string>();
  let revision = 0;
  const controls: {
    failBatch: number | null;
    failure: number | 'network';
    epochStatus: number;
    pauseBatch: number | null;
    reached: ReturnType<typeof deferred<void>>;
    release: ReturnType<typeof deferred<HttpResponse>>;
  } = {
    failBatch: null, failure: 'network', epochStatus: 200, pauseBatch: null,
    reached: deferred<void>(), release: deferred<HttpResponse>(),
  };
  const get = <E extends SyncEntity>(entity: E, id: string): EntityRows[E] | undefined =>
    rows.get(key(entity, id))?.row as EntityRows[E] | undefined;
  const write = (change: ServerChange): void => {
    revision += 1;
    // The entity and row remain paired when only their revision changes.
    rows.set(rowKey(change), { ...change, row: { ...change.row, revision } } as ServerChange);
  };
  const missingReference = ({ row }: ServerChange): boolean => {
    const references: [SyncEntity, string | null][] = [];
    if ('pet_id' in row) references.push(['pets', row.pet_id]);
    if ('pet_ids' in row) references.push(...row.pet_ids.map((id): [SyncEntity, string] => ['pets', id]));
    if ('task_id' in row) references.push(['task_templates', row.task_id]);
    if ('created_by' in row) references.push(['members', row.created_by]);
    if ('completed_by' in row) references.push(['members', row.completed_by]);
    if ('started_by' in row) references.push(['members', row.started_by]);
    if ('user_id' in row) references.push(['members', row.user_id]);
    if ('replaces_task_id' in row) references.push(['task_templates', row.replaces_task_id]);
    return references.some(([entity, id]) => id !== null && !rows.has(key(entity, id)));
  };
  const merge = (change: ReseedRow): 'inserted' | 'updated' | 'unchanged' | 'refused' => {
    if (refused.has(rowKey(change))) return 'refused';
    if (change.entity === 'walk_routes') {
      const walk = get('walk_sessions', change.row.walk_id);
      if (walk === undefined) return 'refused';
      if (walk.status !== 'finished' || walk.has_route) return 'unchanged';
      routes.set(walk.id, change.row.points);
      write({ entity: 'walk_sessions', row: {
        ...walk, has_route: true, point_count: change.row.points.length,
      } });
      return 'updated';
    }
    if (change.entity === 'assets') throw new Error('Assets must use the upload route');
    if (missingReference(change)) return 'refused';
    const existing = rows.get(rowKey(change));
    if (existing?.entity === 'members') return 'unchanged';
    let row = existing !== undefined && existing.row.updated_at >= change.row.updated_at
      ? { ...existing.row } : { ...change.row };
    if (existing !== undefined) {
      for (const field of ['deleted_at', 'undone_at', 'cancelled_at'] as const) {
        const oldValue = field in existing.row ? existing.row[field as keyof typeof existing.row] : null;
        const newValue = field in change.row ? change.row[field as keyof typeof change.row] : null;
        const instants = [oldValue, newValue].filter((value): value is string => typeof value === 'string');
        if (instants.length > 0) {
          row = { ...row, [field]: instants.sort()[0] };
          if (field === 'undone_at' && 'undone_by' in existing.row && 'undone_by' in change.row) {
            row = { ...row, undone_by: oldValue === instants[0] ? existing.row.undone_by : change.row.undone_by };
          }
        }
      }
      row.updated_at = [existing.row.updated_at, change.row.updated_at].sort().at(-1) ?? row.updated_at;
    }
    if (change.entity === 'walk_sessions' && 'status' in row) {
      const stored = get('walk_sessions', row.id);
      const ranks = { active: 0, finished: 1, discarded: 2 };
      if (stored !== undefined && ranks[stored.status] > ranks[change.row.status]) row = { ...stored };
      row = { ...row, has_route: stored?.has_route ?? false, point_count: stored?.point_count ?? 0 };
    }
    if (existing !== undefined && JSON.stringify({ ...row, revision: null })
      === JSON.stringify({ ...existing.row, revision: null })) return 'unchanged';
    // Merge keeps the incoming entity; the union cannot express that after field merging.
    write({ entity: change.entity, row } as ServerChange);
    return existing === undefined ? 'inserted' : 'updated';
  };
  const handle = async (request: HttpRequest): Promise<HttpResponse> => {
    const path = request.url.replace(/^https:\/\/[^/]+\/api\/v1/, '');
    if (path === '/auth/refresh') return response(401);
    if (request.method === 'GET' && path.startsWith('/sync?')) {
      const query = new URL(request.url).searchParams;
      const since = Number(query.get('since'));
      const limit = Number(query.get('limit'));
      if (limit === 1 && controls.epochStatus !== 200) return response(controls.epochStatus);
      const remaining = [...rows.values()].filter(({ row }) => (row.revision ?? 0) > since)
        .sort((a, b) => (a.row.revision ?? 0) - (b.row.revision ?? 0));
      const changes = remaining.slice(0, limit);
      const hasMore = remaining.length > limit;
      const page: Page = { changes, has_more: hasMore, epoch: syncEpoch,
        revision: hasMore ? changes.at(-1)?.row.revision ?? revision : revision };
      if (limit === 500) pages.push(page);
      return response(200, page);
    }
    if (request.method === 'POST' && path === '/reseed') {
      const batch = (request.body as { rows: ReseedRow[] }).rows;
      batches.push(batch);
      if (batch.length > 500) return response(422);
      if (batches.length === controls.pauseBatch) {
        controls.reached.resolve();
        return controls.release.promise;
      }
      if (batches.length === controls.failBatch) {
        if (controls.failure === 'network') throw new Error('simulated network failure');
        return response(controls.failure);
      }
      if (batch.some((change) => invalid.has(rowKey(change)))) return response(422);
      const counts = { inserted: 0, updated: 0, unchanged: 0, refused: 0, duplicates: 0 };
      for (const change of batch) counts[merge(change)] += 1;
      return response(200, counts);
    }
    const [, resource, id, action] = path.split('/');
    const now = new Date(clock.now()).toISOString();
    if (resource === 'pets') {
      const existing = id === undefined ? undefined : get('pets', id);
      if (request.method === 'POST' && id === undefined) {
        const body = request.body as PetCreate & { id: string };
        const owner = [...rows.values()].find((change) => change.entity === 'members')?.row.id;
        if (owner === undefined) return response(404);
        const pet: Pet = {
          sex: 'unknown', breed: null, color: null, birthdate: null, microchip_id: null,
          avatar_asset_id: null, notes: null, sort_order: 0, archived_at: null,
          created_by: owner, deleted_at: null, ...body, revision: 0, updated_at: now,
        };
        write({ entity: 'pets', row: pet });
        return response(200, get('pets', pet.id));
      }
      if (existing === undefined) return response(404);
      write({ entity: 'pets', row: { ...existing, ...request.body as Partial<Pet>, updated_at: now } });
      return response(200, get('pets', existing.id));
    }
    if (resource === 'completions' && id !== undefined && action === 'undo') {
      const completion = get('task_completions', id);
      if (completion === undefined) return response(404);
      if (completion.undone_at === null) write({ entity: 'task_completions',
        row: { ...completion, undone_at: now, undone_by: completion.completed_by, updated_at: now } });
      return response(200, get('task_completions', id));
    }
    if (resource === 'timers' && id !== undefined && action === 'cancel') {
      const timer = get('task_timers', id);
      if (timer === undefined) return response(404);
      if (timer.cancelled_at === null) write({ entity: 'task_timers',
        row: { ...timer, cancelled_at: now, updated_at: now } });
      return response(200, get('task_timers', id));
    }
    if (resource === 'walks' && id !== undefined && action === 'finish') {
      const walk = get('walk_sessions', id);
      if (walk?.status === 'finished' || walk?.status === 'discarded') return response(200, walk);
      const { route, ...fields } = request.body as WalkFinish;
      const owner = [...rows.values()].find((change) => change.entity === 'members')?.row.id;
      if (owner === undefined || !rows.has(key('pets', fields.pet_id))) return response(404);
      routes.set(id, route);
      write({ entity: 'walk_sessions', row: {
        id, user_id: owner, deleted_at: null, note: null, ...walk, ...fields,
        status: 'finished', has_route: route.length > 0, point_count: route.length, updated_at: now,
        revision: 0,
      } });
      return response(200, get('walk_sessions', id));
    }
    return response(404);
  };
  return { rows, routes, batches, pages, refused, invalid, controls, get, write, handle,
    get revision() { return revision; } };
}

let c: SyncContext;
let server: ReturnType<typeof fakeServer>;
let fileSystem: ReturnType<typeof fakeFileSystem>;
let engine: Engine | undefined;

beforeEach(async () => {
  c = await syncContext();
  server = fakeServer(c.clock);
  fileSystem = fakeFileSystem();
  jest.useFakeTimers();
});
afterEach(() => {
  engine?.dispose();
  engine = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  c.driver.close();
});

function connectServer(): void {
  c.http.enqueue(...Array.from({ length: 100 }, () => server.handle));
}

function makeArrival() {
  const logRejectedRow = jest.fn<void, [SyncEntity | 'walk_routes', string]>();
  const pull: Pull = createPull({ ...c, arrive: (target) => arrival.arrive(target) });
  const arrival: Arrive = createArrive({ ...c, pull, fileSystem, logRejectedRow });
  return { arrival, pull, logRejectedRow };
}

function seed(changes: ServerChange[]): void { c.apply.applyServerRows(changes); }
function foundation(): ServerChange[] {
  return [
    { entity: 'members', row: c.factory.members({ id: c.factory.memberId }) },
    { entity: 'family', row: c.factory.family() },
    { entity: 'pets', row: c.factory.pets({ id: c.factory.petId }) },
    { entity: 'task_templates', row: c.factory.task_templates({ id: c.factory.taskId }) },
  ];
}
function diskKeys(): string[] {
  return c.driver.all<{ entity: string; id: string }>('SELECT entity, id FROM replica')
    .map(({ entity, id }) => key(entity, id)).sort();
}
function expectConverged(): void {
  expect(diskKeys()).toEqual([...server.rows.keys()].sort());
  for (const change of server.rows.values()) {
    expect(c.replica.get(change.entity, change.row.id)?.row).toEqual(change.row);
  }
}
function seedMany(): void {
  seed(foundation());
  seed(Array.from({ length: 501 }, () => ({ entity: 'pets', row: c.factory.pets() })));
}
function allReseedRows(): ReseedRow[] { return server.batches.flat(); }

test('RS-11 fake server: missing edits return 404; reseeds merge time and preserve tombstones', async () => {
  const member = c.factory.members({ id: c.factory.memberId });
  const pet = c.factory.pets();
  const request = (method: HttpRequest['method'], path: string, body?: unknown): HttpRequest => ({
    method, url: `${servers.primary}${path}`, body,
  });
  expect((await server.handle(request('PATCH', `/pets/${pet.id}`, { name: 'Edited' }))).status).toBe(404);
  const send = (changes: ReseedRow[]) => server.handle(request('POST', '/reseed', { rows: changes }));
  expect((await send([{ entity: 'members', row: member }, { entity: 'pets', row: pet }])).status).toBe(200);
  c.clock.advance(1_000);
  const newer = { ...pet, name: 'Edited', updated_at: new Date(c.clock.now()).toISOString(),
    deleted_at: new Date(c.clock.now()).toISOString() };
  await send([{ entity: 'pets', row: newer }]);
  const revision = server.revision;
  await send([{ entity: 'pets', row: pet }, { entity: 'pets', row: newer }]);
  expect(server.get('pets', pet.id)).toMatchObject({
    name: newer.name, updated_at: newer.updated_at, deleted_at: newer.deleted_at,
  });
  expect(server.revision).toBe(revision);
});

test('RS-1: reseed sends acknowledged rows in dependency order, 500 a call, then cached routes', async () => {
  const base = foundation();
  const successor = c.factory.task_templates({ replaces_task_id: null });
  const root = c.factory.task_templates();
  successor.replaces_task_id = root.id;
  const deleted = c.factory.weight_entries({ deleted_at: new Date(c.clock.now()).toISOString() });
  const health = c.factory.health_events();
  const duplicate = c.factory.task_completions({ occurrence_key: '2020-01-01',
    undone_at: new Date(c.clock.now()).toISOString() });
  const original = c.factory.task_completions({ occurrence_key: '2020-01-01' });
  duplicate.duplicate_of = original.id;
  const timer = c.factory.task_timers({ cancelled_at: new Date(c.clock.now()).toISOString() });
  const walks = Array.from({ length: 501 }, () => c.factory.walk_sessions({ status: 'finished' }));
  const points: RoutePoint[] = [[0, 0, c.clock.now(), 8], [0.001, 0, c.clock.now() + 3_000, 8]];
  const asset = c.factory.assets();
  seed([
    ...walks.map((row): ServerChange => ({ entity: 'walk_sessions', row })),
    { entity: 'task_timers', row: timer }, { entity: 'task_completions', row: duplicate },
    { entity: 'task_completions', row: original }, { entity: 'health_events', row: health },
    { entity: 'weight_entries', row: deleted }, { entity: 'task_templates', row: successor },
    { entity: 'task_templates', row: root }, ...base, { entity: 'assets', row: asset },
  ]);
  for (const walk of [...walks].reverse()) new WalkRepo(c.driver).upsertRoute({ walkId: walk.id, points });
  c.kv.set('last_revision.primary', '71');
  c.kv.set('reseeded_epoch.primary', previousEpoch);
  connectServer();
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  const expected: ReseedRow[] = [
    ...base, { entity: 'task_templates', row: root }, { entity: 'task_templates', row: successor },
    { entity: 'weight_entries', row: deleted }, { entity: 'health_events', row: health },
    { entity: 'task_completions', row: original }, { entity: 'task_completions', row: duplicate },
    { entity: 'task_timers', row: timer },
    ...walks.map((row): ReseedRow => ({ entity: 'walk_sessions', row })),
    ...walks.map((walk): ReseedRow => ({ entity: 'walk_routes', row: { walk_id: walk.id, points } })),
  ];
  expect(allReseedRows()).toEqual(expected);
  expect(server.batches[0]).toHaveLength(500);
  expect(server.batches.every((batch) => batch.length > 0 && batch.length <= 500)).toBe(true);
  expect(server.batches.filter((batch) => batch[0]?.entity === 'walk_routes').map((batch) => batch.length))
    .toEqual([500, 1]);
  expect(c.http.requests[0]?.url).toBe(`${servers.primary}/sync?since=71&limit=1`);
  for (const request of c.http.requests.filter((request) => request.url.endsWith('/reseed'))) {
    expect(request.headers).not.toHaveProperty('Idempotency-Key');
  }
  expect(server.routes.size).toBe(501);
  expectConverged();
  expect(c.store.getState().weightEntries[deleted.id]).toBeUndefined();
  expect(c.store.getState().completions[original.id]).toBeUndefined();
});

test('RS-11 / RS-1: queued edits reseed their rows; unacknowledged creates and queued walks drain after pull', async () => {
  const base = foundation();
  const completion = c.factory.task_completions();
  const timer = c.factory.task_timers();
  const walk = c.factory.walk_sessions();
  const weight = c.factory.weight_entries();
  const health = c.factory.health_events();
  seed([...base, { entity: 'task_completions', row: completion }, { entity: 'task_timers', row: timer },
    { entity: 'walk_sessions', row: walk }, { entity: 'weight_entries', row: weight },
    { entity: 'health_events', row: health }]);
  c.clock.advance(1_000);
  c.mutations.patchPet(c.factory.petId, { name: 'Edited Aurora' });
  c.mutations.undoCompletion(completion.id);
  c.mutations.cancelTimer(timer.id);
  const route: RoutePoint[] = [[0, 0, c.clock.now(), 8], [0.001, 0, c.clock.now() + 3_000, 8]];
  c.mutations.finishWalk(walk.id, {
    pet_id: walk.pet_id, started_at: walk.started_at, ended_at: new Date(c.clock.now()).toISOString(),
    paused_ms: 0, distance_m: 110, duration_s: 60, avg_pace_s_per_km: 545,
    preview: [[0, 0], [0.001, 0]], route,
  });
  const newPetId = c.mutations.createPet({ name: 'New pet', species: 'cat' });
  const queuedBefore = c.driver.all('SELECT * FROM outbox ORDER BY seq');
  const edited = c.replica.get('pets', c.factory.petId)?.row;
  const undone = c.replica.get('task_completions', completion.id)?.row;
  const cancelled = c.replica.get('task_timers', timer.id)?.row;
  if (edited === undefined || undone === undefined || cancelled === undefined) {
    throw new Error('Expected the queued local rows');
  }
  const locallyEdited: ServerChange[] = [
    { entity: 'pets', row: edited }, { entity: 'task_completions', row: undone },
    { entity: 'task_timers', row: cancelled },
  ];
  connectServer();
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  expect(allReseedRows()).toEqual(expect.arrayContaining(locallyEdited));
  for (const change of locallyEdited) {
    expect(allReseedRows().filter((sent) => rowKey(sent) === rowKey(change))).toHaveLength(1);
  }
  expect(allReseedRows().some((change) => rowKey(change) === key('pets', newPetId))).toBe(false);
  expect(allReseedRows().some((change) => rowKey(change) === key('walk_sessions', walk.id))).toBe(false);
  expect(server.get('pets', newPetId)).toBeUndefined();
  expect(server.get('walk_sessions', walk.id)).toBeUndefined();
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(queuedBefore);
  expect(await c.drain.drain()).toBe('empty');
  expect(server.get('pets', c.factory.petId)?.name).toBe('Edited Aurora');
  expect(server.get('task_completions', completion.id)?.undone_at).toBe(undone.undone_at);
  expect(server.get('task_timers', timer.id)?.cancelled_at).toBe(cancelled.cancelled_at);
  expect(server.get('walk_sessions', walk.id)).toMatchObject({ status: 'finished', has_route: true, point_count: 2 });
  expect(server.routes.get(walk.id)).toEqual(route);
  expect(server.get('pets', newPetId)?.name).toBe('New pet');
  expect(c.deadLetter.count()).toBe(0);
  expectConverged();
  const firstMutation = c.http.requests.findIndex((request) => !request.url.includes('/sync?')
    && !request.url.endsWith('/reseed'));
  const lastPull = c.http.requests.findLastIndex((request) => request.url.includes('limit=500'));
  expect(firstMutation).toBeGreaterThan(lastPull);
});

test('RS-7: a process interrupted between reseed batches keeps everything and restarts from the top', async () => {
  seedMany();
  const before = diskKeys();
  server.controls.pauseBatch = 2;
  connectServer();
  const running = makeArrival().arrival.arrive('primary');
  await Promise.race([server.controls.reached.promise, running.then(() => {
    throw new Error('Arrival ended before the second batch was reached');
  })]);
  const snapshot = c.driver.export();
  expect(diskKeys()).toEqual(before);
  expect(server.batches).toHaveLength(2);
  expect(c.kv.get('reseeded_epoch.primary')).toBeNull();
  // Discard the interrupted process after releasing its blocked transport.
  server.controls.release.resolve(response(503));
  expect(await running).toBe('transient');
  c.driver.close();
  c = await syncContext(snapshot);
  expect(diskKeys()).toEqual(before);
  const firstBatch = server.batches[0];
  server.controls.pauseBatch = null;
  const restartAt = server.batches.length;
  connectServer();
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  expect(server.batches[restartAt]).toEqual(firstBatch);
  expectConverged();
});

test.each(['between pull pages', 'before sweep'] as const)(
  'RS-7: a crash %s keeps every replica row and a second run completes', async (phase) => {
    seedMany();
    const refusedPet = c.factory.pets();
    seed([{ entity: 'pets', row: refusedPet }]);
    server.refused.add(key('pets', refusedPet.id));
    const pendingId = c.mutations.createPet({ name: 'Offline create', species: 'cat' });
    const before = diskKeys();
    const beforeOutbox = c.driver.all('SELECT * FROM outbox');
    let snapshot: Uint8Array | undefined;
    c.driver.onTransactionEnd((committed) => {
      const page = server.pages.at(-1);
      if (!committed || snapshot !== undefined || page === undefined
        || c.kv.get('last_revision.primary') !== String(page.revision)
        || (phase === 'between pull pages' ? !page.has_more : page.has_more)) return;
      snapshot = c.driver.export();
      throw new Error(`simulated crash ${phase}`);
    });
    connectServer();
    await expect(makeArrival().arrival.arrive('primary')).rejects.toThrow(`simulated crash ${phase}`);
    expect(diskKeys()).toEqual(before);
    expect(c.store.getState().pets[refusedPet.id]).toBeDefined();
    expect(c.driver.all('SELECT * FROM outbox')).toEqual(beforeOutbox);
    if (snapshot === undefined) throw new Error('Expected a committed pull page snapshot');
    c.driver.close();
    c = await syncContext(snapshot);
    expect(diskKeys()).toEqual(before);
    const oldGeneration = Number(c.kv.get('pull_gen'));
    connectServer();
    expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
    expect(Number(c.kv.get('pull_gen'))).toBeGreaterThan(oldGeneration);
    expect(c.replica.get('pets', refusedPet.id)).toBeNull();
    expect(c.store.getState().pets[refusedPet.id]).toBeUndefined();
    expect(c.replica.get('pets', pendingId)).not.toBeNull();
    expect(c.driver.all('SELECT * FROM outbox')).toEqual(beforeOutbox);
    expect(diskKeys()).toEqual([...server.rows.keys(), key('pets', pendingId)].sort());
  },
);

test('RS-7: sweep keeps marked rows, outbox rows and writes during pull, matching both entity and id', async () => {
  seed(foundation());
  const refusedPet = c.factory.pets();
  const protectedPet = c.factory.pets();
  const otherEntity = c.factory.weight_entries({ id: protectedPet.id });
  const duringPull = c.factory.pets();
  seed([{ entity: 'pets', row: refusedPet }, { entity: 'pets', row: protectedPet },
    { entity: 'weight_entries', row: otherEntity }]);
  c.apply.applyLocalRow('pets', refusedPet);
  c.mutations.patchPet(protectedPet.id, { name: 'Protected intent' });
  server.refused.add(key('pets', refusedPet.id));
  server.refused.add(key('pets', protectedPet.id));
  server.refused.add(key('weight_entries', otherEntity.id));
  let wroteDuringPull = false;
  c.driver.onTransactionEnd((committed) => {
    const page = server.pages.at(-1);
    if (!committed || wroteDuringPull || page === undefined || page.has_more
      || c.kv.get('last_revision.primary') !== String(page.revision)) return;
    wroteDuringPull = true;
    c.apply.applyLocalRow('pets', duringPull);
  });
  connectServer();
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  expect(wroteDuringPull).toBe(true);
  expect(c.replica.get('pets', refusedPet.id)).toBeNull();
  expect(c.replica.get('weight_entries', otherEntity.id)).toBeNull();
  expect(c.store.getState().pets[refusedPet.id]).toBeUndefined();
  expect(c.store.getState().weightEntries[otherEntity.id]).toBeUndefined();
  expect(c.replica.get('pets', protectedPet.id)?.row.name).toBe('Protected intent');
  expect(c.outbox.count()).toBe(1);
  expect(c.replica.get('pets', duringPull.id)?.pullGen).toBe(Number(c.kv.get('pull_gen')));
  expect(c.store.getState().pets[duringPull.id]).toEqual(duringPull);
  for (const change of server.rows.values()) {
    expect(c.replica.get(change.entity, change.row.id)?.pullGen).toBe(Number(c.kv.get('pull_gen')));
  }
});

test('RS-1: held files absent from the server return to to_upload after the full pull', async () => {
  const repo = new AssetRepo(c.driver);
  const missing = (['uploaded', 'downloaded', 'failed', 'to_upload'] as const).map((state) => c.factory.assetFile({
    state,
    localUri: `file:///assets/${state}.jpg`,
  }));
  const present = c.factory.assetFile({ state: 'uploaded', localUri: 'file:///assets/present.jpg' });
  const unavailable = c.factory.assetFile({ state: 'uploaded', localUri: 'file:///assets/absent.jpg' });
  const noUri = c.factory.assetFile({ state: 'failed', localUri: null });
  for (const file of [...missing, present, unavailable, noUri]) repo.upsert(file);
  for (const file of [...missing, present]) {
    if (file.localUri === null) throw new Error('Expected a held file URI');
    fileSystem.write(file.localUri, new Uint8Array([1, 2, 3]));
  }
  const held = missing[0];
  if (held === undefined) throw new Error('Expected a held file');
  const staleAsset = c.factory.assets({ id: held.id });
  seed([{ entity: 'assets', row: staleAsset }]);
  server.write({ entity: 'assets', row: c.factory.assets({ id: present.id }) });
  connectServer();
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  for (const file of missing) expect(repo.get(file.id)?.state).toBe('to_upload');
  expect(repo.get(present.id)).toEqual(present);
  expect(repo.get(unavailable.id)).toEqual(unavailable);
  expect(repo.get(noUri.id)).toEqual(noUri);
  expect(c.replica.get('assets', staleAsset.id)).toBeNull();
  expect(c.store.getState().assets[present.id]).toBeDefined();
  expect(server.batches).toEqual([]);
  expect(fileSystem.requests).toEqual([]);
});

test('RS-1: a 422 batch retries row by row and logs only the invalid entity and id', async () => {
  seed(foundation());
  const good = c.factory.health_events();
  const bad = c.factory.health_events({ title: 'Invalid\u0000private row content' });
  seed([{ entity: 'health_events', row: good }, { entity: 'health_events', row: bad }]);
  server.invalid.add(key('health_events', bad.id));
  connectServer();
  const { arrival, logRejectedRow } = makeArrival();
  expect(await arrival.arrive('primary')).toBe('ok');
  const original = server.batches[0];
  if (original === undefined) throw new Error('Expected a reseed batch');
  expect(original).toHaveLength(6);
  expect(server.batches.slice(1)).toEqual(original.map((change) => [change]));
  expect(logRejectedRow.mock.calls).toEqual([['health_events', bad.id]]);
  expect(JSON.stringify(logRejectedRow.mock.calls)).not.toContain(bad.title);
  expect(c.replica.get('health_events', bad.id)).toBeNull();
  expect(c.replica.get('health_events', good.id)?.row).toEqual(server.get('health_events', good.id));
  expectConverged();
});

test('RS-1: an empty replica skips reseed and still pulls and marks the server epoch', async () => {
  connectServer();
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  expect(server.batches).toEqual([]);
  expect(c.http.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/sync?since=0&limit=1`, `${servers.primary}/sync?since=0&limit=500`,
  ]);
  expect(c.kv.get('reseeded_epoch.primary')).toBe(syncEpoch);
  expect(c.kv.get('last_revision.primary')).toBe('0');
  expect(Number(c.kv.get('pull_gen'))).toBeGreaterThan(0);
});

test.each(['network', 500, 503] as const)(
  'RS-7: %s in batch two leaves the epoch unchanged and retries every row on the next arrival', async (failure) => {
    seedMany();
    const before = c.driver.all('SELECT * FROM replica ORDER BY entity, id');
    c.kv.set('reseeded_epoch.primary', previousEpoch);
    c.kv.set('last_revision.primary', '71');
    server.controls.failBatch = 2;
    server.controls.failure = failure;
    connectServer();
    const { arrival } = makeArrival();
    expect(await arrival.arrive('primary')).toBe('transient');
    expect(server.batches).toHaveLength(2);
    expect(c.kv.get('reseeded_epoch.primary')).toBe(previousEpoch);
    expect(c.kv.get('last_revision.primary')).toBe('71');
    expect(c.driver.all('SELECT * FROM replica ORDER BY entity, id')).toEqual(before);
    expect(server.pages).toEqual([]);
    const attempted = allReseedRows();
    server.controls.failBatch = null;
    expect(await arrival.arrive('primary')).toBe('ok');
    expect(server.batches.slice(2).flat()).toEqual(attempted);
    expect(c.kv.get('reseeded_epoch.primary')).toBe(syncEpoch);
    expectConverged();
  },
);

test('RS-7: the reseeded epoch and zero cursor roll back together on a metadata write failure', async () => {
  seed(foundation());
  c.kv.set('reseeded_epoch.primary', previousEpoch);
  c.kv.set('last_revision.primary', '71');
  const before = diskKeys();
  c.driver.run(`CREATE TRIGGER crash_arrival_metadata BEFORE INSERT ON kv
    WHEN NEW.key = 'last_revision.primary' AND NEW.value = '0'
    BEGIN SELECT RAISE(ABORT, 'simulated metadata crash'); END`);
  connectServer();
  await expect(makeArrival().arrival.arrive('primary')).rejects.toThrow('simulated metadata crash');
  expect(c.kv.get('reseeded_epoch.primary')).toBe(previousEpoch);
  expect(c.kv.get('last_revision.primary')).toBe('71');
  expect(diskKeys()).toEqual(before);
  expect(server.pages).toEqual([]);
  c.driver.run('DROP TRIGGER crash_arrival_metadata');
  expect(await makeArrival().arrival.arrive('primary')).toBe('ok');
  expectConverged();
});

test.each(['primary', 'reserve'] as const)(
  'PL-3 / RS-9: a changed epoch on %s reseeds before pulling from zero without touching the other server', async (target) => {
    await c.session.adopt(wireSession(target), target);
    const other = target === 'primary' ? 'reserve' : 'primary';
    c.kv.set('active_server', target);
    c.kv.set(serverKey('last_revision', target), '71');
    c.kv.set(serverKey('reseeded_epoch', target), previousEpoch);
    c.kv.set(serverKey('last_revision', other), '9876');
    c.kv.set(serverKey('reseeded_epoch', other), 'other-server-epoch');
    c.kv.set(serverKey('sync_epoch', other), 'other-sync-epoch');
    const otherBefore = c.driver.all('SELECT * FROM kv WHERE key LIKE ? ORDER BY key', [`%.${other}`]);
    seed(foundation());
    connectServer();
    expect(await makeArrival().pull.pull()).toBe('ok');
    const reads = c.http.requests.filter((request) => request.method === 'GET').map((request) => request.url);
    expect(reads).toEqual([
      `${servers[target]}/sync?since=71&limit=500`, `${servers[target]}/sync?since=71&limit=1`,
      `${servers[target]}/sync?since=0&limit=500`,
    ]);
    expect(server.batches).toHaveLength(1);
    expect(c.kv.get('active_server')).toBe(target);
    expect(c.kv.get(serverKey('reseeded_epoch', target))).toBe(syncEpoch);
    expect(c.driver.all('SELECT * FROM kv WHERE key LIKE ? ORDER BY key', [`%.${other}`])).toEqual(otherBefore);
    for (const request of c.http.requests) {
      expect(request.url.startsWith(servers[target])).toBe(true);
      expect(request.headers?.Authorization).toBe(`Bearer ${wireSession(target).access_token}`);
    }
    expectConverged();
  },
);

test('RS-9: direct arrival selects the destination before reading its own cursor and epoch', async () => {
  await c.session.adopt(wireSession('reserve'), 'reserve');
  c.kv.set('last_revision.primary', '9876');
  c.kv.set('last_revision.reserve', '23');
  c.kv.set('reseeded_epoch.primary', 'other-server-epoch');
  connectServer();
  expect(await makeArrival().arrival.arrive('reserve')).toBe('ok');
  expect(c.kv.get('active_server')).toBe('reserve');
  expect(c.http.requests.map((request) => request.url)).toEqual([
    `${servers.reserve}/sync?since=23&limit=1`, `${servers.reserve}/sync?since=0&limit=500`,
  ]);
  expect(c.kv.get('last_revision.primary')).toBe('9876');
  expect(c.kv.get('reseeded_epoch.primary')).toBe('other-server-epoch');
});

test('RS-7 / RS-9: a destination without a session returns auth and keeps the replica and outbox', async () => {
  seed(foundation());
  c.mutations.patchPet(c.factory.petId, { name: 'Kept offline' });
  const before = c.driver.all('SELECT * FROM replica ORDER BY entity, id');
  const queuedBefore = c.driver.all('SELECT * FROM outbox');
  expect(await makeArrival().arrival.arrive('reserve')).toBe('auth');
  expect(c.kv.get('active_server')).toBe('reserve');
  expect(c.http.requests).toEqual([]);
  expect(c.driver.all('SELECT * FROM replica ORDER BY entity, id')).toEqual(before);
  expect(c.driver.all('SELECT * FROM outbox')).toEqual(queuedBefore);
});

test.each(['epoch', 'reseed'] as const)(
  'RS-7: a 401 during %s hands back auth without sweeping or marking the epoch', async (phase) => {
    seed(foundation());
    const before = diskKeys();
    c.kv.set('reseeded_epoch.primary', previousEpoch);
    if (phase === 'epoch') server.controls.epochStatus = 401;
    else { server.controls.failBatch = 1; server.controls.failure = 401; }
    connectServer();
    expect(await makeArrival().arrival.arrive('primary')).toBe('auth');
    expect(diskKeys()).toEqual(before);
    expect(c.kv.get('reseeded_epoch.primary')).toBe(previousEpoch);
    expect(server.pages).toEqual([]);
  },
);

test('RS-11 / PL-3: the first engine cycle arrives before draining edits against a server missing their rows', async () => {
  seed(foundation());
  c.mutations.patchPet(c.factory.petId, { name: 'Arrive before edit' });
  connectServer();
  const { arrival, pull } = makeArrival();
  engine = createEngine({ ...c, outbox: c.drain, pull, arrive: (target) => arrival.arrive(target),
    createSocket: () => ({ state: 'closed', connect: async () => {}, close() {} }),
    online: true, foreground: false,
  });
  await engine.kick('start');
  expect(c.deadLetter.count()).toBe(0);
  expect(c.outbox.count()).toBe(0);
  expect(server.get('pets', c.factory.petId)?.name).toBe('Arrive before edit');
  const editIndex = c.http.requests.findIndex((request) => request.method === 'PATCH');
  const fullPullIndex = c.http.requests.findIndex((request) => request.url.includes('since=0&limit=500'));
  expect(fullPullIndex).toBeGreaterThan(0);
  expect(editIndex).toBeGreaterThan(fullPullIndex);
  expect(engine.state.getState().status).toBe('synced');
  expectConverged();
});

test('RS-7 / PL-3: a failed full pull restarts arrival before an ordinary pull can skip its sweep', async () => {
  seed(foundation());
  const refused = c.factory.pets();
  seed([{ entity: 'pets', row: refused }]);
  server.refused.add(key('pets', refused.id));
  c.kv.set('reseeded_epoch.primary', previousEpoch);
  const before = diskKeys();
  c.http.enqueue(server.handle, server.handle, server.handle, response(503));
  const { pull } = makeArrival();
  expect(await pull.pull()).toBe('transient');
  expect(c.kv.get('reseeded_epoch.primary')).toBe(syncEpoch);
  expect(diskKeys()).toEqual(before);
  const requestCount = c.http.requests.length;
  connectServer();
  expect(await pull.pull()).toBe('ok');
  expect(c.http.requests[requestCount]?.url).toBe(`${servers.primary}/sync?since=0&limit=1`);
  expect(server.batches).toHaveLength(2);
  expect(c.replica.get('pets', refused.id)).toBeNull();
  expectConverged();
});

test('RS-7 / RS-11: an engine retry completes the delegated arrival before sending newly queued edits', async () => {
  seed(foundation());
  c.kv.set('reseeded_epoch.primary', previousEpoch);
  c.http.enqueue(server.handle, server.handle, server.handle, response(503));
  const { pull, arrival } = makeArrival();
  engine = createEngine({ ...c, outbox: c.drain, pull, arrive: arrival.arrive,
    random: fakeRandom(0.5),
    createSocket: () => ({ state: 'closed', connect: async () => {}, close() {} }),
    online: true, foreground: false,
  });
  await engine.kick('start');
  expect(engine.state.getState().status).toBe('offline');
  c.clock.advance(1_000);
  c.mutations.patchPet(c.factory.petId, { name: 'Queued during failed arrival' });
  connectServer();
  await engine.kick('refresh');
  expect(server.batches).toHaveLength(2);
  expect(server.batches[1]).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity: 'pets', row: expect.objectContaining({
      id: c.factory.petId, name: 'Queued during failed arrival',
    }) }),
  ]));
  const editIndex = c.http.requests.findIndex((request) => request.method === 'PATCH');
  const reseedIndex = c.http.requests.findLastIndex((request) => request.url.endsWith('/reseed'));
  expect(editIndex).toBeGreaterThan(reseedIndex);
  expect(engine.state.getState().status).toBe('synced');
  expect(c.deadLetter.count()).toBe(0);
  expectConverged();
});

test('RS-1 / RS-11: production wiring supplies arrival to pull and engine and wakes requeued uploads', async () => {
  seed(foundation());
  c.mutations.patchPet(c.factory.petId, { name: 'Production arrival' });
  const files = new AssetRepo(c.driver);
  const file = c.factory.assetFile({ state: 'uploaded' });
  files.upsert(file);
  if (file.localUri === null) throw new Error('Expected a held file');
  fileSystem.write(file.localUri, new Uint8Array([1, 2, 3]));
  const uploadStates: (string | undefined)[] = [];
  const uploads = { kick: jest.fn(async () => { uploadStates.push(files.get(file.id)?.state); }),
    dispose: jest.fn() };
  let networkListener: Parameters<typeof NetInfo.addEventListener>[0] | undefined;
  const unsubscribe = jest.fn();
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    networkListener = listener;
    return unsubscribe;
  });
  const originalState = AppState.currentState;
  AppState.currentState = 'background';
  const appState = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  connectServer();
  const wired = createSyncEngine({ ...c, outbox: c.drain, fileSystem, uploads,
    logRejectedRow: jest.fn(),
    createSocket: () => ({ state: 'closed', connect: async () => {}, close() {} }),
  });
  try {
    if (networkListener === undefined) throw new Error('Expected a network subscription');
    networkListener({ type: NetInfoStateType.other, isConnected: true,
      isInternetReachable: true, details: { isConnectionExpensive: false } });
    await jest.advanceTimersByTimeAsync(0);
    expect(wired.engine.state.getState().status).toBe('synced');
    expect(server.get('pets', c.factory.petId)?.name).toBe('Production arrival');
    expect(server.batches).toHaveLength(1);
    expect(c.kv.get('reseeded_epoch.primary')).toBe(syncEpoch);
    expect(c.deadLetter.count()).toBe(0);
    expect(uploadStates).toEqual(['uploaded', 'to_upload']);
    expectConverged();
  } finally {
    wired.dispose();
    appState.mockRestore();
    AppState.currentState = originalState;
    jest.mocked(NetInfo.addEventListener).mockReset();
  }
  expect(uploads.dispose).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
