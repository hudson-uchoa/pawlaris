import { createApi } from '../../api/client';
import { AssetRepo } from '../../db/assetRepo';
import { DeadLetterRepo } from '../../db/deadLetterRepo';
import { Kv, serverKey, type Server, type ServerKeyName } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { OutboxRepo } from '../../db/outboxRepo';
import { ReplicaRepo } from '../../db/replicaRepo';
import { WalkRepo } from '../../db/walkRepo';
import { createReplicaApply, hydrateReplica } from '../../replica/apply';
import { createReplicaStore } from '../../replica/store';
import { createEngine, type Engine } from '../../sync/engine';
import { createMutations } from '../../sync/mutations';
import { createOutbox } from '../../sync/outbox';
import { createPull } from '../../sync/pull';
import type { Socket } from '../../sync/socket';
import { syncContext, type SyncContext } from '../../sync/__tests__/support';
import { fakeRandom } from '../../testing/fakeRandom';
import { memoryDriver } from '../../testing/memoryDriver';
import { createLifecycle, type LifecycleDependencies } from '../lifecycle';
import type { FakeSecretBox } from '../../testing/fakeSecretBox';
import { createSession, type WireSession } from '../session';
import { deferred, response, servers, wireSession } from './support';

const syncEpoch = '00000000-0000-4000-8000-000000000031';
const wipedTables = [
  'replica', 'outbox', 'dead_letter', 'asset_file', 'local_walk', 'walk_point', 'walk_route_cache',
] as const;
const serverKeys: ServerKeyName[] = [
  'last_revision', 'sync_epoch', 'reseeded_epoch', 'signed_out', 'push_token_sent',
];
let c: SyncContext;
let engine: Engine | undefined;

beforeEach(async () => {
  c = await syncContext();
  c.kv.set('reseeded_epoch.primary', syncEpoch);
  jest.useFakeTimers();
});

afterEach(() => {
  engine?.dispose();
  engine = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  c.driver.close();
});

function activeServer(): Server {
  return c.kv.get('active_server') === 'reserve' ? 'reserve' : 'primary';
}

function makeEngine() {
  const arrive = async () => 'ok' as const;
  const socket: Socket = { state: 'closed', connect: async () => {}, close: () => {} };
  const created = createEngine({
    driver: c.driver, session: c.session, clock: c.clock, random: fakeRandom(0.5),
    serverSelect: { current: activeServer, report: async () => {}, tick: async () => {} },
    arrive, outbox: c.drain,
    pull: createPull({ driver: c.driver, apply: c.apply, api: c.api, arrive }),
    createSocket: () => socket, online: true, foreground: false,
  });
  engine = created;
  return created;
}

function makeLifecycle(overrides: Partial<LifecycleDependencies> = {}) {
  // These cleanup seams model only this task's effects, not P3-8 file transport.
  const files = new Set(['file:///assets/avatar.jpg', 'file:///assets/proof.jpg', 'file:///assets/orphan.jpg']);
  const notifications = new Set(['rem:fake-task:2026-10-13T08:00', 'tmr:fake-timer']);
  let tracking = true;
  const removeAssetFiles = jest.fn(async () => { files.clear(); });
  const cancelNotifications = jest.fn(async () => { notifications.clear(); });
  const stopTracking = jest.fn(async () => { tracking = false; });
  const kick = jest.fn<void | Promise<void>, ['login']>();
  const lifecycle = createLifecycle({
    driver: c.driver, store: c.store, clock: c.clock, session: c.session,
    api: c.api, activeServer,
    kick, removeAssetFiles, cancelNotifications, stopTracking, ...overrides,
  });
  return { lifecycle, files, notifications, removeAssetFiles, cancelNotifications, stopTracking,
    kick, tracking: () => tracking };
}

function seedPreviousUser() {
  const changes = [
    { entity: 'family' as const, row: c.factory.family() },
    { entity: 'members' as const, row: c.factory.members() },
    { entity: 'pets' as const, row: c.factory.pets({ id: c.factory.petId }) },
    { entity: 'pets' as const, row: c.factory.pets({ deleted_at: '2026-10-13T12:00:00Z' }) },
    { entity: 'weight_entries' as const, row: c.factory.weight_entries() },
    { entity: 'health_events' as const, row: c.factory.health_events() },
    { entity: 'task_templates' as const, row: c.factory.task_templates() },
    { entity: 'task_completions' as const, row: c.factory.task_completions() },
    { entity: 'task_completions' as const, row: c.factory.task_completions({ occurrence_key: '2020-01-01' }) },
    { entity: 'task_timers' as const, row: c.factory.task_timers() },
    { entity: 'walk_sessions' as const, row: c.factory.walk_sessions() },
    { entity: 'assets' as const, row: c.factory.assets() },
  ];
  c.apply.applyServerRows(changes);
  c.mutations.patchPet(c.factory.petId, { name: 'Previous user intent' });
  c.mutations.createWeight({ pet_id: c.factory.petId, weight_kg: 4.5,
    measured_at: new Date(c.clock.now()).toISOString() });
  new DeadLetterRepo(c.driver).upsert(c.factory.deadLetter());
  const assets = new AssetRepo(c.driver);
  assets.upsert(c.factory.assetFile({ localUri: 'file:///assets/avatar.jpg' }));
  assets.upsert(c.factory.assetFile({ localUri: 'file:///assets/proof.jpg' }));
  const walks = new WalkRepo(c.driver);
  const walk = c.factory.localWalk();
  walks.upsertLocal(walk);
  walks.insertPoint(c.factory.walkPoint({ walkId: walk.id }));
  walks.upsertRoute({ walkId: walk.id, points: [[-23.55, -46.63, c.clock.now(), 8]] });
  c.kv.set('device_id', '00000000-0000-4000-8000-000000000090');
  c.kv.set('dashboard_scope', 'all');
  c.kv.set('suppressed_reminders', '["rem:fake-task:2026-10-13T08:00"]');
  c.kv.set('pull_gen', '7');
  c.kv.set('active_server', 'primary');
  for (const server of ['primary', 'reserve'] as const) {
    for (const key of serverKeys) {
      if (key !== 'signed_out') c.kv.set(serverKey(key, server), `fake-${server}-${key}`);
    }
  }
  return changes;
}

function differentUser(): WireSession {
  const wire = wireSession(activeServer(), 'different-user');
  return { ...wire, user: { ...wire.user, id: c.ids.uuid(), email: 'other@example.invalid' } };
}

function diskSnapshot() {
  return { tables: wipedTables.map((table) => c.driver.all(`SELECT * FROM ${table} ORDER BY rowid`)),
    kv: c.driver.all('SELECT * FROM kv ORDER BY key') };
}

function expectWipedData() {
  for (const table of wipedTables) expect(c.driver.all(`SELECT * FROM ${table}`)).toEqual([]);
  expect(c.store.getState()).toMatchObject({
    family: null, members: {}, pets: {}, weightEntries: {}, healthEvents: {},
    taskTemplates: {}, completions: {}, timers: {}, walks: {}, assets: {}, pending: {},
  });
}

async function restart(data: Uint8Array, secretBox: FakeSecretBox = c.secretBox): Promise<SyncContext> {
  const driver = await memoryDriver(data);
  openDatabase(driver);
  const kv = new Kv(driver);
  const store = createReplicaStore();
  const apply = createReplicaApply({ driver, store, clock: c.clock });
  const selected = (): Server => kv.get('active_server') === 'reserve' ? 'reserve' : 'primary';
  const session = createSession({ http: c.http, secretBox, clock: c.clock, kv, servers, activeServer: selected });
  const api = createApi({ http: c.http, session, servers, serverSelect: { current: selected } });
  if (kv.get('session_user') !== null && kv.get(serverKey('signed_out', selected())) !== '1') {
    hydrateReplica({ driver, store, clock: c.clock });
  }
  const dependencies = { ...c, driver, kv, store, apply, secretBox, session, api,
    serverSelect: { current: selected, report: async () => {}, tick: async () => {} } };
  return { ...dependencies,
    replica: new ReplicaRepo(driver), outbox: new OutboxRepo(driver), deadLetter: new DeadLetterRepo(driver),
    drain: createOutbox(dependencies), mutations: createMutations(dependencies) };
}

test('SE-2: refresh 401 signs out, survives restart, and same-user login drains preserved changes', async () => {
  const id = c.mutations.createPet({ name: 'Preserved pet', species: 'cat' });
  const queued = c.outbox.head(c.sessionUser.id);
  const pet = c.replica.get('pets', id)?.row;
  if (queued === null || pet === undefined) throw new Error('Expected preserved local intent');
  await c.session.adopt(wireSession('primary', 'expired', 0));
  c.http.enqueue(response(401));
  const created = makeEngine();
  await created.kick('start');
  expect(created.state.getState().status).toBe('signed_out');
  expect(c.kv.get('signed_out.primary')).toBe('1');
  expect(c.outbox.head(c.sessionUser.id)).toEqual(queued);
  expect(c.replica.get('pets', id)?.row).toEqual(pet);
  expect(c.http.requests.map((request) => request.url)).toEqual([`${servers.primary}/auth/refresh`]);
  created.dispose();
  engine = undefined;
  const data = c.driver.export();
  c.driver.close();
  c = await restart(data);
  const resumed = makeEngine();
  expect(resumed.state.getState().status).toBe('signed_out');
  expect(c.outbox.head(c.sessionUser.id)).toEqual(queued);
  expect(c.replica.get('pets', id)?.row).toEqual(pet);
  const wire = wireSession('primary', 'same-user-login');
  c.http.enqueue(response(200, wire), response(200, { ...pet, revision: 8 }),
    response(200, { changes: [], revision: 9, has_more: false, epoch: syncEpoch }));
  const login = await c.session.login({ email: wire.user.email, password: 'fake-password-for-tests' });
  if ('networkError' in login || !login.ok) throw new Error('Expected successful login');
  expect(c.kv.get('signed_out.primary')).toBe('1');
  const { lifecycle } = makeLifecycle({ kick: (reason) => resumed.kick(reason) });
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.onLogin(login.body, { confirmDiscard })).toBe(true);
  await jest.advanceTimersByTimeAsync(0);
  expect(confirmDiscard).not.toHaveBeenCalled();
  expect(c.kv.get('signed_out.primary')).toBeNull();
  expect(c.outbox.count()).toBe(0);
  expect(c.replica.get('pets', id)).toMatchObject({ row: { ...pet, revision: 8 }, pending: false });
  expect(resumed.state.getState().status).toBe('synced');
});

test('SE-3: different-user login removes every previous row, file, walk and cached route before adoption', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  const next = differentUser();
  const { lifecycle, files, notifications, tracking, kick } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => true);
  expect(await lifecycle.onLogin(next, { confirmDiscard })).toBe(true);
  expect(confirmDiscard).toHaveBeenCalledTimes(1);
  expect(confirmDiscard).toHaveBeenCalledWith(2);
  expectWipedData();
  expect(files.size).toBe(0);
  expect(notifications.size).toBe(0);
  expect(tracking()).toBe(false);
  expect(c.secretBox.snapshot()).toEqual({
    'session_tokens.primary': JSON.stringify({ access_token: next.access_token,
      refresh_token: next.refresh_token, access_expires_at: next.access_expires_at }),
  });
  expect(c.driver.all('SELECT * FROM kv ORDER BY key')).toEqual([
    { key: 'device_id', value: '00000000-0000-4000-8000-000000000090' },
    { key: 'session_user', value: JSON.stringify(next.user) },
  ]);
  expect(kick).toHaveBeenCalledTimes(1);
  expect(kick).toHaveBeenCalledWith('login');
});

test('SE-CONFIRM-FIRST: different-user login waits for discard confirmation before changing any storage', async () => {
  seedPreviousUser();
  const next = differentUser();
  const before = diskSnapshot();
  const secrets = c.secretBox.snapshot();
  const store = c.store.getState();
  const answer = deferred<boolean>();
  const asked = deferred<void>();
  const { lifecycle, kick, removeAssetFiles, cancelNotifications, stopTracking } = makeLifecycle();
  const confirmDiscard = jest.fn((count: number) => {
    expect(count).toBe(2);
    asked.resolve();
    return answer.promise;
  });
  const pending = lifecycle.onLogin(next, { confirmDiscard });
  await asked.promise;
  expect(diskSnapshot()).toEqual(before);
  expect(c.secretBox.snapshot()).toEqual(secrets);
  expect(c.store.getState()).toBe(store);
  expect(kick).not.toHaveBeenCalled();
  expect(removeAssetFiles).not.toHaveBeenCalled();
  expect(cancelNotifications).not.toHaveBeenCalled();
  expect(stopTracking).not.toHaveBeenCalled();
  answer.resolve(true);
  expect(await pending).toBe(true);
  expectWipedData();
  expect(JSON.parse(c.kv.get('session_user') ?? 'null')).toEqual(next.user);
});

test('SE-CONFIRM-REFUSED: refusing different-user login preserves both token sets, replica and outbox', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  const next = differentUser();
  const secrets = c.secretBox.snapshot();
  const before = diskSnapshot();
  const store = c.store.getState();
  const { lifecycle, kick, files, notifications, tracking, removeAssetFiles } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.onLogin(next, { confirmDiscard })).toBe(false);
  expect(confirmDiscard).toHaveBeenCalledWith(2);
  expect(c.secretBox.snapshot()).toEqual(secrets);
  expect(diskSnapshot()).toEqual(before);
  expect(c.store.getState()).toBe(store);
  expect(files.size).toBe(3);
  expect(notifications.size).toBe(2);
  expect(tracking()).toBe(true);
  expect(removeAssetFiles).not.toHaveBeenCalled();
  expect(kick).not.toHaveBeenCalled();
});

test('SE-WIPE-ADOPT-CRASH: death after wipe and before the first new token write restarts empty at login', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  const values = new Map(Object.entries(c.secretBox.snapshot()));
  let killed = false;
  let atAdoption: Uint8Array | undefined;
  let secretsAtAdoption: Readonly<Record<string, string>> | undefined;
  const secretBox: FakeSecretBox = {
    async get(key) { return values.get(key) ?? null; },
    async del(key) { values.delete(key); },
    async set(key, value) {
      if (killed) {
        atAdoption = c.driver.export();
        secretsAtAdoption = Object.fromEntries(values);
        throw new Error('simulated process death before adoption');
      }
      values.set(key, value);
    },
    snapshot: () => Object.fromEntries(values),
  };
  const session = createSession({ http: c.http, secretBox, clock: c.clock, kv: c.kv, servers, activeServer });
  const api = createApi({ http: c.http, session, servers, serverSelect: { current: activeServer } });
  const { lifecycle, files, notifications, tracking, kick } = makeLifecycle({ session, api });
  const next = differentUser();
  killed = true;
  await expect(lifecycle.onLogin(next, { confirmDiscard: async () => true }))
    .rejects.toThrow('simulated process death before adoption');
  expect(secretsAtAdoption).toEqual({});
  expect(files.size).toBe(0);
  expect(notifications.size).toBe(0);
  expect(tracking()).toBe(false);
  expect(kick).not.toHaveBeenCalled();
  if (atAdoption === undefined) throw new Error('Expected a snapshot at the adoption boundary');
  c.driver.close();
  c = await restart(atAdoption, secretBox);
  expectWipedData();
  expect(c.kv.get('session_user')).toBeNull();
  expect(c.secretBox.snapshot()).toEqual({});
  const resumed = makeEngine();
  expect(resumed.state.getState().status).toBe('signed_out');
  await resumed.kick('start');
  expect(c.http.requests).toEqual([]);
});

test('SE-WIPE / RS-9: one committed wipe deletes both servers tokens and keys; only device_id survives', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  for (const server of ['primary', 'reserve'] as const) c.kv.set(serverKey('signed_out', server), '1');
  const outcomes: boolean[] = [];
  c.driver.onTransactionEnd((committed) => {
    outcomes.push(committed);
    if (committed) {
      for (const table of wipedTables) expect(c.driver.all(`SELECT * FROM ${table}`)).toEqual([]);
      expect(c.driver.all('SELECT * FROM kv')).toEqual([
        { key: 'device_id', value: '00000000-0000-4000-8000-000000000090' },
      ]);
    }
  });
  const { lifecycle, files, notifications, tracking } = makeLifecycle();
  await lifecycle.wipe();
  expect(outcomes).toEqual([true]);
  expectWipedData();
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.driver.all('SELECT * FROM kv')).toEqual([
    { key: 'device_id', value: '00000000-0000-4000-8000-000000000090' },
  ]);
  expect(files.size).toBe(0);
  expect(notifications.size).toBe(0);
  expect(tracking()).toBe(false);
});

test('SE-WIPE-ATOMIC: a database failure rolls back every deleted table and the store', async () => {
  seedPreviousUser();
  const before = diskSnapshot();
  const secrets = c.secretBox.snapshot();
  const store = c.store.getState();
  const notify = jest.fn();
  c.store.subscribe(notify);
  c.driver.run(`CREATE TRIGGER fail_wipe BEFORE DELETE ON walk_route_cache
    BEGIN SELECT RAISE(ABORT, 'simulated wipe transaction failure'); END`);
  const { lifecycle } = makeLifecycle();
  await expect(lifecycle.wipe()).rejects.toThrow('simulated wipe transaction failure');
  expect(diskSnapshot()).toEqual(before);
  expect(c.store.getState()).toBe(store);
  expect(notify).not.toHaveBeenCalled();
  expect(c.secretBox.snapshot()).toEqual(secrets);
});

test('SE-LOGIN-SAME: same-user login adopts its server alone and keeps all data without confirmation', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  c.kv.set('signed_out.primary', '1');
  const tables = diskSnapshot().tables;
  const reserve = c.secretBox.snapshot()['session_tokens.reserve'];
  const reserveKeys = c.driver.all('SELECT * FROM kv WHERE key LIKE ? ORDER BY key', ['%.reserve']);
  const next = wireSession('primary', 'renewed');
  const { lifecycle, kick, removeAssetFiles } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.onLogin(next, { confirmDiscard })).toBe(true);
  expect(confirmDiscard).not.toHaveBeenCalled();
  expect(diskSnapshot().tables).toEqual(tables);
  expect(c.kv.get('signed_out.primary')).toBeNull();
  expect(c.secretBox.snapshot()['session_tokens.reserve']).toBe(reserve);
  expect(c.driver.all('SELECT * FROM kv WHERE key LIKE ? ORDER BY key', ['%.reserve'])).toEqual(reserveKeys);
  expect(await c.session.accessToken()).toBe(next.access_token);
  expect(removeAssetFiles).not.toHaveBeenCalled();
  expect(kick).toHaveBeenCalledWith('login');
});

test('SE-LOGIN-FIRST: no previous user adopts immediately without wiping or asking', async () => {
  await c.session.clear('primary');
  c.kv.remove('session_user');
  c.kv.set('device_id', '00000000-0000-4000-8000-000000000090');
  const next = wireSession('primary', 'first-login');
  const { lifecycle, kick, removeAssetFiles } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.onLogin(next, { confirmDiscard })).toBe(true);
  expect(confirmDiscard).not.toHaveBeenCalled();
  expect(removeAssetFiles).not.toHaveBeenCalled();
  expect(JSON.parse(c.kv.get('session_user') ?? 'null')).toEqual(next.user);
  expect(await c.session.accessToken()).toBe(next.access_token);
  expect(c.kv.get('device_id')).toBe('00000000-0000-4000-8000-000000000090');
  expect(kick).toHaveBeenCalledWith('login');
});

test('SE-LOGIN-DIFFERENT-EMPTY: a different user wipes old data even when the outbox is empty', async () => {
  seedPreviousUser();
  c.driver.run('DELETE FROM outbox');
  const next = differentUser();
  const { lifecycle } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.onLogin(next, { confirmDiscard })).toBe(true);
  expect(confirmDiscard).not.toHaveBeenCalled();
  expectWipedData();
  expect(JSON.parse(c.kv.get('session_user') ?? 'null')).toEqual(next.user);
});

test('SE-LOGOUT-REFUSED: refusing logout sends nothing and leaves both sessions and all data intact', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  const before = diskSnapshot();
  const secrets = c.secretBox.snapshot();
  const { lifecycle, files, tracking, removeAssetFiles } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.logout({ confirmDiscard })).toBe(false);
  expect(confirmDiscard).toHaveBeenCalledTimes(1);
  expect(confirmDiscard).toHaveBeenCalledWith(2);
  expect(c.http.requests).toEqual([]);
  expect(diskSnapshot()).toEqual(before);
  expect(c.secretBox.snapshot()).toEqual(secrets);
  expect(files.size).toBe(3);
  expect(tracking()).toBe(true);
  expect(removeAssetFiles).not.toHaveBeenCalled();
});

test.each<Server>(['primary', 'reserve'])(
  'SE-LOGOUT / RS-9: confirmed logout makes both best-effort requests only to active %s then wipes', async (server) => {
    seedPreviousUser();
    await c.session.adopt(wireSession('reserve'), 'reserve');
    c.kv.set('active_server', server);
    c.http.enqueue(response(204), response(204));
    const { lifecycle, files, notifications, tracking } = makeLifecycle();
    const confirmDiscard = jest.fn(async () => true);
    expect(await lifecycle.logout({ confirmDiscard })).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith(2);
    expect(c.http.requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'DELETE', url: `${servers[server]}/me/push-token`, body: { token: `fake-${server}-push_token_sent` } },
      { method: 'POST', url: `${servers[server]}/auth/logout`, body: { refresh_token: wireSession(server).refresh_token } },
    ]);
    expectWipedData();
    expect(c.secretBox.snapshot()).toEqual({});
    expect(c.kv.get('session_user')).toBeNull();
    expect(files.size).toBe(0);
    expect(notifications.size).toBe(0);
    expect(tracking()).toBe(false);
  },
);

test('SE-LOGOUT-BEST-EFFORT: network failures in both logout requests still wipe both sessions', async () => {
  seedPreviousUser();
  await c.session.adopt(wireSession('reserve'), 'reserve');
  c.http.enqueue(new Error('simulated push-token deletion failure'), new Error('simulated logout failure'));
  const { lifecycle } = makeLifecycle();
  expect(await lifecycle.logout({ confirmDiscard: async () => true })).toBe(true);
  expect(c.http.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/me/push-token`, `${servers.primary}/auth/logout`,
  ]);
  expectWipedData();
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.kv.get('session_user')).toBeNull();
});

test('SE-LOGOUT-EMPTY: an empty outbox logs out without discard confirmation', async () => {
  c.kv.set('push_token_sent.primary', 'fake-primary-push-token');
  c.http.enqueue(response(204), response(204));
  const { lifecycle } = makeLifecycle();
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.logout({ confirmDiscard })).toBe(true);
  expect(confirmDiscard).not.toHaveBeenCalled();
  expect(c.http.requests).toHaveLength(2);
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.kv.get('session_user')).toBeNull();
});

test('SE-LOGIN-REHYDRATE: same-user login after a signed-out restart hydrates preserved rows before kicking sync', async () => {
  seedPreviousUser();
  const previous = c.store.getState();
  c.kv.set('signed_out.primary', '1');
  const data = c.driver.export();
  c.driver.close();
  c = await restart(data);
  expect(c.store.getState().ready).toBe(false);
  const kick = jest.fn(() => {
    expect(c.store.getState()).toEqual(previous);
    expect(c.outbox.count()).toBe(2);
  });
  const { lifecycle, removeAssetFiles } = makeLifecycle({ kick });
  const confirmDiscard = jest.fn(async () => false);
  expect(await lifecycle.onLogin(wireSession('primary', 'same-user-restart'), { confirmDiscard })).toBe(true);
  expect(kick).toHaveBeenCalledWith('login');
  expect(confirmDiscard).not.toHaveBeenCalled();
  expect(removeAssetFiles).not.toHaveBeenCalled();
  expect(c.store.getState()).toEqual(previous);
});
