import { ReplicaRepo } from '../../db/replicaRepo';
import { memoryDriver } from '../../testing/memoryDriver';
import { hydrate } from '../hydrate';
import { createReplicaStore } from '../store';
import { selectPet } from '../selectors';
import { replicaContext, type ReplicaContext } from './support';

let context: ReplicaContext | undefined;
beforeEach(async () => { context = await replicaContext(); });
afterEach(() => { context?.driver.close(); context = undefined; });

function current(): ReplicaContext {
  if (context === undefined) throw new Error('Replica test context is missing');
  return context;
}

test('RP-1: a restart reproduces every slice and pending key after mixed applies', async () => {
  const ctx = current();
  const { apply, factory, store, driver } = ctx;
  hydrate(ctx);
  const family = factory.family();
  const member = factory.members();
  const pet = factory.pets();
  const weight = factory.weight_entries();
  const health = factory.health_events();
  const template = factory.task_templates();
  const completion = factory.task_completions();
  const timer = factory.task_timers();
  const walk = factory.walk_sessions();
  const asset = factory.assets();
  apply.applyServerRows([
    { entity: 'family', row: family }, { entity: 'members', row: member },
    { entity: 'pets', row: pet }, { entity: 'weight_entries', row: weight },
    { entity: 'health_events', row: health }, { entity: 'task_templates', row: template },
    { entity: 'task_completions', row: completion }, { entity: 'task_timers', row: timer },
    { entity: 'walk_sessions', row: walk }, { entity: 'assets', row: asset },
  ], { cursor: 20 });
  const localPet = { ...pet, name: 'Local Aurora' };
  const localCompletion = factory.task_completions({ revision: null });
  apply.applyLocalRow('pets', localPet);
  apply.applyLocalRow('task_completions', localCompletion);
  apply.removeRow('weight_entries', weight.id);
  apply.applyServerRows([{ entity: 'health_events', row: {
    ...health, deleted_at: new Date(ctx.clock.now()).toISOString(),
  } }]);
  const snapshot = store.getState();
  expect(snapshot).toEqual({
    ready: true, family, members: { [member.id]: member }, pets: { [pet.id]: localPet },
    weightEntries: {}, healthEvents: {}, taskTemplates: { [template.id]: template },
    completions: { [completion.id]: completion, [localCompletion.id]: localCompletion },
    timers: { [timer.id]: timer }, walks: { [walk.id]: walk }, assets: { [asset.id]: asset },
    pending: { [`pets:${pet.id}`]: true, [`task_completions:${localCompletion.id}`]: true },
  });
  const reopened = await memoryDriver(driver.export());
  try {
    const fresh = createReplicaStore();
    expect(fresh.getState().ready).toBe(false);
    hydrate({ driver: reopened, store: fresh, clock: ctx.clock });
    expect(fresh.getState()).toEqual(snapshot);
  } finally {
    reopened.close();
  }
});

test('RP-2 (edit): queued local edits survive an older pull until the ack replaces them', () => {
  const { apply, factory, outbox, replica, store } = current();
  const pet = factory.pets({ revision: 8 });
  apply.applyServerRows([{ entity: 'pets', row: pet }]);
  const local = { ...pet, name: 'Local Aurora' };
  apply.applyLocalRow('pets', local);
  const entry = outbox.insert(factory.outbox({ entityId: pet.id, method: 'PATCH' }));
  apply.applyServerRows([{ entity: 'pets', row: { ...pet, revision: 7 } }]);
  expect(store.getState().pets[pet.id]).toEqual(local);
  expect(replica.get('pets', pet.id)).toMatchObject({ pending: true, row: local });
  const ack = { ...local, name: 'Acknowledged Aurora', revision: 9 };
  outbox.remove(entry.seq);
  apply.applyServerRows([{ entity: 'pets', row: ack }]);
  expect(store.getState().pets[pet.id]).toEqual(ack);
  expect(replica.get('pets', pet.id)).toMatchObject({ pending: false, revision: 9, row: ack });
  expect(store.getState().pending[`pets:${pet.id}`]).toBeUndefined();
});

test('RP-2 (delete): a queued local delete is not resurrected and its ack keeps it gone', () => {
  const { apply, factory, outbox, replica, store, clock } = current();
  const weight = factory.weight_entries();
  apply.applyServerRows([{ entity: 'weight_entries', row: weight }]);
  apply.removeRow('weight_entries', weight.id);
  const entry = outbox.insert(factory.outbox({
    entity: 'weight_entries', entityId: weight.id, method: 'DELETE', body: null,
  }));
  apply.applyServerRows([{ entity: 'weight_entries', row: weight }]);
  expect(replica.get('weight_entries', weight.id)).toBeNull();
  expect(store.getState().weightEntries[weight.id]).toBeUndefined();
  outbox.remove(entry.seq);
  const ack = { ...weight, deleted_at: new Date(clock.now()).toISOString(), revision: 2 };
  apply.applyServerRows([{ entity: 'weight_entries', row: ack }]);
  expect(replica.get('weight_entries', weight.id)).toMatchObject({ deleted: true, row: ack });
  expect(store.getState().weightEntries[weight.id]).toBeUndefined();
});

test('RP-2: pending alone does not protect a row when no outbox entry exists', () => {
  const { apply, factory, store, replica } = current();
  const local = factory.pets({ revision: null, name: 'Local Aurora' });
  apply.applyLocalRow('pets', local);
  const server = { ...local, revision: 5, name: 'Server Aurora' };
  apply.applyServerRows([{ entity: 'pets', row: server }]);
  expect(store.getState().pets[local.id]).toEqual(server);
  expect(replica.get('pets', local.id)?.pending).toBe(false);
  expect(store.getState().pending[`pets:${local.id}`]).toBeUndefined();
});

test('RP-2: outbox protection matches both entity and id, including incoming tombstones', () => {
  const { apply, factory, outbox, store, replica, clock } = current();
  const pet = factory.pets();
  const member = factory.members({ id: pet.id });
  apply.applyLocalRow('pets', pet);
  outbox.insert(factory.outbox({ entityId: pet.id }));
  const deleted = { ...pet, deleted_at: new Date(clock.now()).toISOString() };
  apply.applyServerRows([
    { entity: 'pets', row: deleted }, { entity: 'members', row: member },
  ], { cursor: 14, pullGen: 6 });
  expect(store.getState().pets[pet.id]).toEqual(pet);
  expect(replica.get('pets', pet.id)).toMatchObject({ deleted: false, pending: true, pullGen: 0 });
  expect(store.getState().members[pet.id]).toEqual(member);
  expect(replica.get('members', member.id)?.pullGen).toBe(6);
  expect(current().kv.get('last_revision.primary')).toBe('14');
});

test('RP-3: an outer rollback restores disk and memory and never notifies subscribers', () => {
  const ctx = current();
  const existing = ctx.factory.pets();
  ctx.apply.applyServerRows([{ entity: 'pets', row: existing }], { cursor: 3 });
  const before = ctx.store.getState();
  const diskBefore = ctx.driver.all('SELECT * FROM replica ORDER BY entity, id');
  const listener = jest.fn();
  const unsubscribe = ctx.store.subscribe(listener);
  const created = ctx.factory.pets({ revision: null });
  const failure = new Error('Injected outer rollback');
  expect(() => ctx.driver.transaction(() => {
    ctx.apply.applyLocalRow('pets', created);
    ctx.apply.removeRow('pets', existing.id);
    ctx.apply.applyServerRows([{ entity: 'members', row: ctx.factory.members() }], { cursor: 4 });
    expect(ctx.store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    throw failure;
  })).toThrow(failure);
  expect(ctx.driver.all('SELECT * FROM replica ORDER BY entity, id')).toEqual(diskBefore);
  expect(ctx.replica.get('pets', created.id)).toBeNull();
  expect(ctx.store.getState()).toBe(before);
  expect(ctx.kv.get('last_revision.primary')).toBe('3');
  expect(listener).not.toHaveBeenCalled();
  ctx.apply.applyLocalRow('pets', created);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(ctx.store.getState().pets[created.id]).toEqual(created);
  unsubscribe();
});

test('P3-2 batch: nested applies publish once only after the outer transaction commits', () => {
  const { driver, apply, factory, store, replica } = current();
  const first = factory.pets();
  const second = factory.pets();
  const member = factory.members();
  const before = store.getState();
  const listener = jest.fn(() => {
    expect(replica.get('pets', first.id)?.row).toEqual(first);
    expect(replica.get('pets', second.id)?.row).toEqual(second);
  });
  const unsubscribe = store.subscribe(listener);
  driver.transaction(() => {
    apply.applyLocalRow('pets', first);
    driver.transaction(() => {
      apply.applyLocalRow('pets', second);
      apply.applyServerRows([{ entity: 'members', row: member }]);
    });
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getState().pets).toEqual({ [first.id]: first, [second.id]: second });
  expect(store.getState().members).toEqual({ [member.id]: member });
  unsubscribe();
});

test('P3-2 batch: a server page notifies once with every row present', () => {
  const { apply, factory, store } = current();
  const first = factory.pets();
  const second = factory.pets();
  const listener = jest.fn();
  const unsubscribe = store.subscribe(listener);
  apply.applyServerRows([{ entity: 'pets', row: first }, { entity: 'pets', row: second }]);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]?.[0].pets).toEqual({ [first.id]: first, [second.id]: second });
  unsubscribe();
});

test('P3-2 tombstone: a deleted row leaves memory, stays on disk and is never hydrated', async () => {
  const ctx = current();
  const pet = ctx.factory.pets();
  ctx.apply.applyLocalRow('pets', pet);
  const deleted = { ...pet, deleted_at: new Date(ctx.clock.now()).toISOString(), revision: 2 };
  ctx.apply.applyServerRows([{ entity: 'pets', row: deleted }]);
  expect(selectPet(ctx.store.getState(), pet.id)).toBeNull();
  expect(ctx.store.getState().pending[`pets:${pet.id}`]).toBeUndefined();
  expect(ctx.driver.all('SELECT deleted, pending, json FROM replica WHERE id = ?', [pet.id]))
    .toEqual([{ deleted: 1, pending: 0, json: JSON.stringify(deleted) }]);
  expect(ctx.replica.pageForReseed(null, 500)).toEqual([
    expect.objectContaining({ id: pet.id, deleted: true, row: deleted }),
  ]);
  const reopened = await memoryDriver(ctx.driver.export());
  try {
    const store = createReplicaStore();
    hydrate({ driver: reopened, store, clock: ctx.clock });
    expect(store.getState().pets).toEqual({});
    expect(new ReplicaRepo(reopened).get('pets', pet.id)?.deleted).toBe(true);
  } finally {
    reopened.close();
  }
});

test.each([
  { name: 'explicit generation', currentGen: '4', options: { pullGen: 17 }, expected: 17 },
  { name: 'explicit zero', currentGen: '4', options: { pullGen: 0 }, expected: 0 },
  { name: 'current generation', currentGen: '4', options: {}, expected: 4 },
  { name: 'unwritten generation', currentGen: null, options: {}, expected: 0 },
])('P3-2 pull_gen: server live rows and tombstones carry $name',
  ({ currentGen, options, expected }) => {
    const { apply, factory, kv, replica, clock } = current();
    if (currentGen !== null) kv.set('pull_gen', currentGen);
    const pet = factory.pets();
    const deleted = factory.pets({ deleted_at: new Date(clock.now()).toISOString() });
    apply.applyServerRows([{ entity: 'pets', row: pet }, { entity: 'pets', row: deleted }], options);
    expect(replica.get('pets', pet.id)?.pullGen).toBe(expected);
    expect(replica.get('pets', deleted.id)).toMatchObject({ pullGen: expected, deleted: true });
    expect(kv.get('pull_gen')).toBe(currentGen);
  },
);

test.each([
  { name: 'current generation', currentGen: '8', expected: 8 },
  { name: 'unwritten generation', currentGen: null, expected: 0 },
])('P3-2 pull_gen: local upserts carry $name and removals leave no stale row',
  ({ currentGen, expected }) => {
    const { apply, factory, kv, replica, store } = current();
    if (currentGen !== null) kv.set('pull_gen', currentGen);
    const pet = factory.pets({ revision: null });
    apply.applyLocalRow('pets', pet);
    expect(replica.get('pets', pet.id)).toMatchObject({ pullGen: expected, pending: true });
    apply.removeRow('pets', pet.id);
    expect(replica.get('pets', pet.id)).toBeNull();
    expect(store.getState().pets[pet.id]).toBeUndefined();
    expect(store.getState().pending[`pets:${pet.id}`]).toBeUndefined();
    expect(kv.get('pull_gen')).toBe(currentGen);
  },
);

test('P3-2 pull_gen: local writes during a full pull read the generation at write time', () => {
  const { apply, factory, kv, replica } = current();
  const pet = factory.pets({ revision: 7 });
  apply.applyLocalRow('pets', pet);
  kv.set('pull_gen', '12');
  const updated = { ...pet, name: 'During full pull' };
  apply.applyLocalRow('pets', updated);
  expect(replica.get('pets', pet.id)).toMatchObject({ revision: 7, pullGen: 12, row: updated });
});

test.each([null, 'primary', 'reserve'] as const)(
  'P3-2 cursor: active_server %s writes only its own cursor, including zero',
  (server) => {
    const { apply, factory, kv, replica } = current();
    kv.set('last_revision.primary', '31');
    kv.set('last_revision.reserve', '42');
    if (server !== null) kv.set('active_server', server);
    const pet = factory.pets();
    apply.applyServerRows([{ entity: 'pets', row: pet }], { cursor: 0 });
    const active = server ?? 'primary';
    expect(kv.get(`last_revision.${active}`)).toBe('0');
    expect(kv.get(`last_revision.${active === 'primary' ? 'reserve' : 'primary'}`))
      .toBe(active === 'primary' ? '42' : '31');
    expect(kv.get('last_revision')).toBeNull();
    expect(replica.get('pets', pet.id)?.row).toEqual(pet);
    apply.applyServerRows([], { cursor: 10 });
    expect(kv.get(`last_revision.${active}`)).toBe('10');
    apply.applyServerRows([]);
    expect(kv.get(`last_revision.${active}`)).toBe('10');
  },
);

test('RP-3 cursor: failure writing a page cursor rolls back rows and sends no notification', () => {
  const ctx = current();
  ctx.kv.set('last_revision.reserve', '5');
  ctx.kv.set('active_server', 'reserve');
  const before = ctx.store.getState();
  const listener = jest.fn();
  const unsubscribe = ctx.store.subscribe(listener);
  const run = ctx.driver.run.bind(ctx.driver);
  const failure = new Error('Injected cursor write failure');
  const spy = jest.spyOn(ctx.driver, 'run').mockImplementation((sql, params) => {
    if (params?.[0] === 'last_revision.reserve') throw failure;
    run(sql, params);
  });
  try {
    expect(() => ctx.apply.applyServerRows([
      { entity: 'pets', row: ctx.factory.pets() },
    ], { cursor: 6 })).toThrow(failure);
    expect(ctx.driver.all('SELECT * FROM replica')).toEqual([]);
    expect(ctx.kv.get('last_revision.reserve')).toBe('5');
    expect(ctx.store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    unsubscribe();
  }
});

test('P3-2 completion window: old rows stay on disk and the family-local cutoff is inclusive', async () => {
  const ctx = current();
  ctx.apply.applyServerRows([{ entity: 'family', row: ctx.factory.family() }]);
  // Frozen instant is October 12 in the family timezone; 120 days back is June 14.
  const old = ctx.factory.task_completions({ occurrence_key: '2026-06-13T23:59' });
  const boundary = ctx.factory.task_completions({ occurrence_key: '2026-06-14' });
  const timedBoundary = ctx.factory.task_completions({ occurrence_key: '2026-06-14T00:01' });
  const recent = ctx.factory.task_completions();
  const oldWeight = ctx.factory.weight_entries({ measured_at: '2020-01-01T00:00:00Z' });
  ctx.apply.applyServerRows([
    { entity: 'task_completions', row: old }, { entity: 'task_completions', row: boundary },
    { entity: 'task_completions', row: timedBoundary }, { entity: 'task_completions', row: recent },
    { entity: 'weight_entries', row: oldWeight },
  ]);
  expect(ctx.replica.get('task_completions', old.id)?.row).toEqual(old);
  expect(ctx.store.getState().completions).toEqual({
    [boundary.id]: boundary, [timedBoundary.id]: timedBoundary, [recent.id]: recent,
  });
  const reopened = await memoryDriver(ctx.driver.export());
  try {
    const store = createReplicaStore();
    hydrate({ driver: reopened, store, clock: ctx.clock });
    expect(store.getState().completions).toEqual(ctx.store.getState().completions);
    expect(store.getState().weightEntries[oldWeight.id]).toEqual(oldWeight);
    expect(new ReplicaRepo(reopened).range('task_completions', '2026-06-13', '2026-06-13T23:59'))
      .toEqual([expect.objectContaining({ row: old })]);
  } finally {
    reopened.close();
  }
});

test.each([null, 11])('P3-2 local revision: an upsert preserves revision %s on disk and in memory',
  (revision) => {
    const { apply, factory, replica, store } = current();
    const pet = factory.pets({ revision });
    apply.applyLocalRow('pets', pet);
    expect(replica.get('pets', pet.id)).toMatchObject({ revision, row: pet, pending: true });
    expect(store.getState().pets[pet.id]).toEqual(pet);
    expect(store.getState().pending[`pets:${pet.id}`]).toBe(true);
  },
);

test('P3-2 removal: removing a row scopes the entity key and can be repeated', () => {
  const { apply, factory, store, replica } = current();
  const pet = factory.pets();
  const member = factory.members({ id: pet.id });
  apply.applyLocalRow('pets', pet);
  apply.applyLocalRow('members', member);
  apply.removeRow('pets', pet.id);
  apply.removeRow('pets', pet.id);
  expect(replica.get('pets', pet.id)).toBeNull();
  expect(replica.get('members', member.id)?.row).toEqual(member);
  expect(store.getState().pets).toEqual({});
  expect(store.getState().members[member.id]).toEqual(member);
  expect(store.getState().pending).toEqual({ [`members:${member.id}`]: true });
});

test('P3-2 family removal: another id leaves the family intact and its own id removes it', () => {
  const { apply, factory, store, replica, ids } = current();
  const family = factory.family();
  apply.applyLocalRow('family', family);
  apply.removeRow('family', ids.uuid());
  expect(store.getState().family).toEqual(family);
  expect(replica.get('family', family.id)?.row).toEqual(family);
  apply.removeRow('family', family.id);
  expect(store.getState().family).toBeNull();
  expect(replica.get('family', family.id)).toBeNull();
  expect(store.getState().pending[`family:${family.id}`]).toBeUndefined();
});
