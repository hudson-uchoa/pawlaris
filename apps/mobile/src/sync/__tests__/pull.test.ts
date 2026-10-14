import { servers, wireSession } from '../../auth/__tests__/support';
import { serverKey, type Server } from '../../db/kv';
import type { HttpResponse } from '../../platform/http';
import type { ServerChange } from '../../replica/apply';
import { createPull, type PullResult } from '../pull';
import { syncContext, type SyncContext } from './support';

const syncEpoch = '00000000-0000-4000-8000-000000000031';
const changedEpoch = '00000000-0000-4000-8000-000000000032';
let c: SyncContext;

beforeEach(async () => {
  c = await syncContext();
  c.kv.set('reseeded_epoch.primary', syncEpoch);
});
afterEach(() => { c.driver.close(); });

function makePull(result: PullResult = 'ok') {
  const arrive = jest.fn<Promise<PullResult>, [Server]>().mockResolvedValue(result);
  return { ...createPull({ driver: c.driver, apply: c.apply, api: c.api, arrive }), arrive };
}

function page(changes: ServerChange[], revision: number, hasMore = false, epoch = syncEpoch): HttpResponse {
  return {
    status: 200, headers: {},
    body: { changes, revision, has_more: hasMore, epoch, server_time: new Date(c.clock.now()).toISOString() },
  };
}

function requests() {
  return c.http.requests.map(({ method, url }) => ({ method, url }));
}

test('PL-1: interruption after a committed page resumes after restart without duplicates or omissions', async () => {
  const first = c.factory.pets({ revision: 11 });
  const second = c.factory.weight_entries({ pet_id: first.id, revision: 17 });
  const third = c.factory.health_events({ pet_id: first.id, revision: 23 });
  c.http.enqueue(page([{ entity: 'pets', row: first }], 11, true));
  let snapshot: Uint8Array | undefined;
  c.driver.onTransactionEnd((committed) => {
    if (committed && c.kv.get('last_revision.primary') === '11' && snapshot === undefined) {
      snapshot = c.driver.export();
      throw new Error('simulated process death between pages');
    }
  });
  await expect(makePull().pull()).rejects.toThrow('simulated process death between pages');
  expect(requests()).toEqual([{ method: 'GET', url: `${servers.primary}/sync?since=0&limit=500` }]);
  if (snapshot === undefined) throw new Error('Expected a committed page snapshot');
  c.driver.close();
  c = await syncContext(snapshot);
  expect(c.replica.get('pets', first.id)?.row).toEqual(first);
  expect(c.store.getState().pets[first.id]).toEqual(first);
  expect(c.kv.get('last_revision.primary')).toBe('11');
  c.http.enqueue(
    page([{ entity: 'weight_entries', row: second }], 17, true),
    page([{ entity: 'health_events', row: third }], 29),
  );
  expect(await makePull().pull()).toBe('ok');
  expect(requests()).toEqual([
    { method: 'GET', url: `${servers.primary}/sync?since=11&limit=500` },
    { method: 'GET', url: `${servers.primary}/sync?since=17&limit=500` },
  ]);
  expect(c.driver.all('SELECT entity, id FROM replica ORDER BY revision')).toEqual([
    { entity: 'pets', id: first.id }, { entity: 'weight_entries', id: second.id },
    { entity: 'health_events', id: third.id },
  ]);
  expect(c.replica.get('weight_entries', second.id)?.row).toEqual(second);
  expect(c.replica.get('health_events', third.id)?.row).toEqual(third);
  expect(c.kv.get('last_revision.primary')).toBe('29');
});

test.each(['row', 'cursor'] as const)(
  'PL-2: a crash inside applyServerRows at the %s write rolls back the whole page', async (write) => {
    const original = c.factory.pets({ name: 'Before pull', revision: 5 });
    c.apply.applyServerRows([{ entity: 'pets', row: original }], { cursor: 5 });
    c.kv.set('sync_epoch.primary', syncEpoch);
    const updated = { ...original, name: 'After pull', revision: 9 };
    const added = c.factory.pets({ revision: 12 });
    const beforeDisk = c.driver.all('SELECT * FROM replica ORDER BY entity, id');
    const beforeStore = c.store.getState();
    const listener = jest.fn();
    c.store.subscribe(listener);
    if (write === 'row') {
      c.driver.run(`CREATE TRIGGER crash_page BEFORE INSERT ON replica
        WHEN NEW.revision = 12 BEGIN SELECT RAISE(ABORT, 'simulated page crash'); END`);
    } else {
      c.driver.run(`CREATE TRIGGER crash_page BEFORE INSERT ON kv
        WHEN NEW.key = 'last_revision.primary'
        BEGIN SELECT RAISE(ABORT, 'simulated page crash'); END`);
    }
    c.http.enqueue(page([{ entity: 'pets', row: updated }, { entity: 'pets', row: added }], 15));
    await expect(makePull().pull()).rejects.toThrow('simulated page crash');
    expect(c.driver.all('SELECT * FROM replica ORDER BY entity, id')).toEqual(beforeDisk);
    expect(c.kv.get('last_revision.primary')).toBe('5');
    expect(c.store.getState()).toBe(beforeStore);
    expect(listener).not.toHaveBeenCalled();
    const exported = c.driver.export();
    c.driver.close();
    c = await syncContext(exported);
    expect(c.kv.get('last_revision.primary')).toBe('5');
    expect(c.store.getState().pets).toEqual({ [original.id]: original });
  },
);

test('PL-4: a full pull after rejection restores rejected edits and rows removed by reject', async () => {
  const edited = c.factory.pets({ name: 'Server name', revision: 7 });
  const removed = c.factory.weight_entries({ pet_id: edited.id, revision: 9 });
  c.apply.applyServerRows([
    { entity: 'pets', row: edited }, { entity: 'weight_entries', row: removed },
  ], { cursor: 9 });
  c.mutations.patchPet(edited.id, { name: 'Rejected name' });
  c.mutations.deleteWeight(removed.id);
  c.http.enqueue(
    { status: 422, body: { code: 'validation_error' }, headers: {} },
    { status: 422, body: { code: 'validation_error' }, headers: {} },
  );
  expect(await c.drain.drain()).toBe('empty');
  expect(c.deadLetter.count()).toBe(2);
  expect(c.replica.get('pets', edited.id)).toBeNull();
  expect(c.replica.get('weight_entries', removed.id)).toBeNull();
  expect(c.kv.get('last_revision.primary')).toBe('0');
  c.http.enqueue(page([
    { entity: 'pets', row: edited }, { entity: 'weight_entries', row: removed },
  ], 14));
  expect(await makePull().pull()).toBe('ok');
  expect(requests().slice(2)).toEqual([{ method: 'GET', url: `${servers.primary}/sync?since=0&limit=500` }]);
  expect(c.store.getState().pets).toEqual({ [edited.id]: edited });
  expect(c.store.getState().weightEntries).toEqual({ [removed.id]: removed });
  expect(c.replica.get('pets', edited.id)).toMatchObject({ row: edited, pending: false });
  expect(c.replica.get('weight_entries', removed.id)).toMatchObject({ row: removed, pending: false });
  expect(c.kv.get('last_revision.primary')).toBe('14');
});

test('PL-1: three pages follow has_more and use each returned revision as the next cursor', async () => {
  c.kv.set('last_revision.primary', '4');
  const pet = c.factory.pets({ revision: 8 });
  const completion = c.factory.task_completions({ revision: 13 });
  const asset = c.factory.assets({ revision: 19 });
  c.http.enqueue(
    page([{ entity: 'pets', row: pet }], 8, true),
    page([{ entity: 'task_completions', row: completion }], 13, true),
    page([{ entity: 'assets', row: asset }], 25),
  );
  const pull = makePull();
  expect(await pull.pull()).toBe('ok');
  expect(requests()).toEqual([4, 8, 13].map((since) => ({
    method: 'GET', url: `${servers.primary}/sync?since=${since}&limit=500`,
  })));
  expect(c.store.getState().pets[pet.id]).toEqual(pet);
  expect(c.store.getState().completions[completion.id]).toEqual(completion);
  expect(c.store.getState().assets[asset.id]).toEqual(asset);
  expect(c.kv.get('last_revision.primary')).toBe('25');
  expect(pull.arrive).not.toHaveBeenCalled();
});

test('PL-1: an empty response stores its revision even when no row advances the cursor', async () => {
  c.kv.set('last_revision.primary', '8');
  c.http.enqueue(page([], 37));
  const before = c.store.getState();
  expect(await makePull().pull()).toBe('ok');
  expect(c.kv.get('last_revision.primary')).toBe('37');
  expect(c.store.getState()).toBe(before);
  expect(c.http.requests).toHaveLength(1);
});

test.each(['network', 408, 425, 429, 500, 503] as const)(
  'PL-1: transient %s mid-way keeps the applied page and returns transient', async (failure) => {
    const pet = c.factory.pets({ revision: 8 });
    c.http.enqueue(
      page([{ entity: 'pets', row: pet }], 8, true),
      failure === 'network' ? new Error('simulated network failure') : { status: failure, body: null, headers: {} },
    );
    const pull = makePull();
    expect(await pull.pull()).toBe('transient');
    expect(c.replica.get('pets', pet.id)?.row).toEqual(pet);
    expect(c.store.getState().pets[pet.id]).toEqual(pet);
    expect(c.kv.get('last_revision.primary')).toBe('8');
    expect(c.kv.get('sync_epoch.primary')).toBe(syncEpoch);
    expect(requests()).toEqual([0, 8].map((since) => ({
      method: 'GET', url: `${servers.primary}/sync?since=${since}&limit=500`,
    })));
    expect(pull.arrive).not.toHaveBeenCalled();
  },
);

test.each(['primary', 'reserve'] as const)(
  'PL-3 seam: a changed epoch on %s calls arrive once before writing anything', async (server) => {
    c.kv.set('active_server', server);
    await c.session.adopt(wireSession(server), server);
    c.kv.set(serverKey('reseeded_epoch', server), syncEpoch);
    c.kv.set(serverKey('sync_epoch', server), syncEpoch);
    const local = c.factory.pets({ revision: 5 });
    c.apply.applyServerRows([{ entity: 'pets', row: local }], { cursor: 5 });
    c.mutations.patchPet(local.id, { name: 'Queued local intent' });
    const beforeStore = c.store.getState();
    const beforeDisk = c.driver.all('SELECT * FROM replica');
    const beforeKv = c.driver.all('SELECT * FROM kv ORDER BY key');
    const beforeOutbox = c.driver.all('SELECT * FROM outbox');
    const listener = jest.fn();
    c.store.subscribe(listener);
    const delivered = c.factory.pets({ revision: 41 });
    c.http.enqueue(page([{ entity: 'pets', row: delivered }], 41, true, changedEpoch));
    const pull = makePull('transient');
    expect(await pull.pull()).toBe('transient');
    expect(pull.arrive).toHaveBeenCalledTimes(1);
    expect(pull.arrive).toHaveBeenCalledWith(server);
    expect(c.store.getState()).toBe(beforeStore);
    expect(c.driver.all('SELECT * FROM replica')).toEqual(beforeDisk);
    expect(c.driver.all('SELECT * FROM kv ORDER BY key')).toEqual(beforeKv);
    expect(c.driver.all('SELECT * FROM outbox')).toEqual(beforeOutbox);
    expect(listener).not.toHaveBeenCalled();
    expect(requests()).toEqual([{ method: 'GET', url: `${servers[server]}/sync?since=5&limit=500` }]);
  },
);

test('PL-3 seam: an absent reseeded epoch delegates without initializing sync_epoch', async () => {
  c.kv.remove('reseeded_epoch.primary');
  const before = c.driver.all('SELECT * FROM kv ORDER BY key');
  c.http.enqueue(page([{ entity: 'pets', row: c.factory.pets() }], 1));
  const pull = makePull('auth');
  expect(await pull.pull()).toBe('auth');
  expect(pull.arrive).toHaveBeenCalledTimes(1);
  expect(pull.arrive).toHaveBeenCalledWith('primary');
  expect(c.driver.all('SELECT * FROM kv ORDER BY key')).toEqual(before);
  expect(c.driver.all('SELECT * FROM replica')).toEqual([]);
});

test('PL-1: pullGen is carried by every written entity and tombstone across pages', async () => {
  const changes: ServerChange[] = [
    { entity: 'family', row: c.factory.family({ revision: 1 }) },
    { entity: 'members', row: c.factory.members({ revision: 2 }) },
    { entity: 'pets', row: c.factory.pets({ revision: 3 }) },
    { entity: 'weight_entries', row: c.factory.weight_entries({ revision: 4 }) },
    { entity: 'health_events', row: c.factory.health_events({ revision: 5 }) },
    { entity: 'task_templates', row: c.factory.task_templates({ revision: 6 }) },
    { entity: 'task_completions', row: c.factory.task_completions({ revision: 7 }) },
    { entity: 'task_timers', row: c.factory.task_timers({ revision: 8 }) },
    { entity: 'walk_sessions', row: c.factory.walk_sessions({ revision: 9 }) },
    { entity: 'assets', row: c.factory.assets({ revision: 10 }) },
    { entity: 'pets', row: c.factory.pets({ revision: 11, deleted_at: new Date(c.clock.now()).toISOString() }) },
  ];
  c.kv.set('pull_gen', '3');
  c.http.enqueue(page(changes.slice(0, 5), 5, true), page(changes.slice(5), 11));
  expect(await makePull().pull({ pullGen: 42 })).toBe('ok');
  expect(c.driver.all('SELECT entity, id, pull_gen FROM replica ORDER BY revision'))
    .toEqual(changes.map(({ entity, row }) => ({ entity, id: row.id, pull_gen: 42 })));
  expect(c.kv.get('pull_gen')).toBe('3');
});

test.each(['primary', 'reserve'] as const)(
  'RS-9: pulling %s neither reads nor writes the other server cursor or epochs', async (server) => {
    const other = server === 'primary' ? 'reserve' : 'primary';
    c.kv.set('active_server', server);
    await c.session.adopt(wireSession(server), server);
    c.kv.set(serverKey('last_revision', server), '7');
    c.kv.set(serverKey('reseeded_epoch', server), syncEpoch);
    for (const key of ['last_revision', 'sync_epoch', 'reseeded_epoch'] as const) {
      c.kv.set(serverKey(key, other), key === 'last_revision' ? '900' : changedEpoch);
    }
    const beforeOther = c.driver.all('SELECT * FROM kv WHERE key LIKE ? ORDER BY key', [`%.${other}`]);
    // A forbidden read evaluates invalid JSON; forbidden writes abort in SQL.
    // This exercises the real driver without replacing or wrapping a seam.
    c.driver.run('ALTER TABLE kv RENAME TO pull_kv_storage');
    c.driver.run(`CREATE VIEW kv AS SELECT key,
      CASE WHEN key IN ('last_revision.${other}', 'sync_epoch.${other}', 'reseeded_epoch.${other}')
        THEN json_extract('forbidden other server read', '$') ELSE value END AS value
      FROM pull_kv_storage`);
    c.driver.run(`CREATE TRIGGER pull_kv_insert INSTEAD OF INSERT ON kv BEGIN
      SELECT CASE WHEN NEW.key IN ('last_revision.${other}', 'sync_epoch.${other}', 'reseeded_epoch.${other}')
        THEN RAISE(ABORT, 'forbidden other server write') END;
      INSERT OR REPLACE INTO pull_kv_storage (key, value) VALUES (NEW.key, NEW.value); END`);
    c.driver.run(`CREATE TRIGGER pull_kv_update INSTEAD OF UPDATE ON kv BEGIN
      SELECT CASE WHEN OLD.key LIKE '%.${other}' OR NEW.key LIKE '%.${other}'
        THEN RAISE(ABORT, 'forbidden other server write') END;
      UPDATE pull_kv_storage SET key = NEW.key, value = NEW.value WHERE key = OLD.key; END`);
    c.driver.run(`CREATE TRIGGER pull_kv_delete INSTEAD OF DELETE ON kv BEGIN
      SELECT CASE WHEN OLD.key LIKE '%.${other}'
        THEN RAISE(ABORT, 'forbidden other server write') END;
      DELETE FROM pull_kv_storage WHERE key = OLD.key; END`);
    // Prove the guards fail for the access this test forbids.
    expect(() => c.kv.get(serverKey('last_revision', other))).toThrow('malformed JSON');
    expect(() => c.kv.set(serverKey('sync_epoch', other), 'forbidden')).toThrow('forbidden other server write');
    const row = c.factory.pets({ revision: 12 });
    c.http.enqueue(page([{ entity: 'pets', row }], 18));
    const pull = makePull();
    expect(await pull.pull()).toBe('ok');
    expect(requests()).toEqual([{ method: 'GET', url: `${servers[server]}/sync?since=7&limit=500` }]);
    expect(c.kv.get(serverKey('last_revision', server))).toBe('18');
    expect(c.kv.get(serverKey('sync_epoch', server))).toBe(syncEpoch);
    expect(c.kv.get(serverKey('reseeded_epoch', server))).toBe(syncEpoch);
    expect(c.replica.get('pets', row.id)?.row).toEqual(row);
    expect(c.driver.all('SELECT * FROM pull_kv_storage WHERE key LIKE ? ORDER BY key', [`%.${other}`]))
      .toEqual(beforeOther);
    expect(pull.arrive).not.toHaveBeenCalled();
  },
);

test.each([null, changedEpoch])('PL-1: sync_epoch %s is initialized only when absent', async (stored) => {
  if (stored !== null) c.kv.set('sync_epoch.primary', stored);
  c.http.enqueue(page([], 7));
  const pull = makePull();
  expect(await pull.pull()).toBe('ok');
  expect(c.kv.get('sync_epoch.primary')).toBe(stored ?? syncEpoch);
  expect(c.kv.get('reseeded_epoch.primary')).toBe(syncEpoch);
  expect(pull.arrive).not.toHaveBeenCalled();
});

test('PL-1: a final 401 returns auth without modifying the replica or cursor', async () => {
  c.kv.set('last_revision.primary', '7');
  const before = c.store.getState();
  c.http.enqueue({ status: 401, body: null, headers: {} }, { status: 401, body: null, headers: {} });
  const pull = makePull();
  expect(await pull.pull()).toBe('auth');
  expect(c.kv.get('last_revision.primary')).toBe('7');
  expect(c.store.getState()).toBe(before);
  expect(c.kv.get('sync_epoch.primary')).toBeNull();
  expect(pull.arrive).not.toHaveBeenCalled();
});

test('PL-1: a permanent HTTP failure returns its classification without advancing the cursor', async () => {
  c.kv.set('last_revision.primary', '7');
  c.http.enqueue({ status: 403, body: null, headers: {} });
  const pull = makePull();
  expect(await pull.pull()).toBe('permanent');
  expect(c.kv.get('last_revision.primary')).toBe('7');
  expect(c.kv.get('sync_epoch.primary')).toBeNull();
  expect(c.driver.all('SELECT * FROM replica')).toEqual([]);
  expect(pull.arrive).not.toHaveBeenCalled();
});
