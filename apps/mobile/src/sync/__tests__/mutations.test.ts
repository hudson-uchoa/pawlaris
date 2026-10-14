import type { Completion, HealthEvent, Pet, TaskTemplate, Timer, Walk, WeightEntry } from '@pawlaris/shared';
import { buildFork } from '@pawlaris/shared';
import type { EntityRows, SyncEntity } from '../../db/replicaRepo';
import type { Mutation, TaskCreate, WalkFinish } from '../mutations';
import { createMutations } from '../mutations';
import { petMutation, queued, syncContext, type SyncContext } from './support';

let c: SyncContext;
beforeEach(async () => { c = await syncContext(); });
afterEach(() => { c.driver.close(); });

const stamp = (context: SyncContext) => new Date(context.clock.now()).toISOString();

function expectMutation<E extends SyncEntity>(
  entity: E, id: string, method: string, path: string, body: unknown, row: EntityRows[E] | null,
) {
  expect(queued(c)).toEqual([{ seq: 1, entityId: id, method, path, body }]);
  const entry = c.outbox.head(c.sessionUser.id);
  expect(entry).toMatchObject({
    userId: c.sessionUser.id, entity, entityId: id, createdAt: c.clock.now(),
    attempts: 0, serverErrors: 0, nextRetryAt: 0, lastError: null,
  });
  expect(entry?.clientMutationId).toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
  expect(entry?.clientMutationId).not.toBe(id);
  if (row === null) {
    expect(c.replica.get(entity, id)).toBeNull();
    expect(c.store.getState().pending[`${entity}:${id}`]).toBeUndefined();
  } else {
    const local: EntityRows[E] | undefined = c.replica.get(entity, id)?.row;
    expect(local).toEqual(row);
    expect(c.replica.get(entity, id)).toMatchObject({ pending: true, revision: row.revision });
    expect(c.store.getState().pending[`${entity}:${id}`]).toBe(true);
  }
  expect(c.kick).toHaveBeenCalledTimes(1);
  expect(c.kick).toHaveBeenCalledWith('mutation');
}

function seed<E extends SyncEntity>(entity: E, row: EntityRows[E]) {
  c.apply.applyServerRows([{ entity, row } as Parameters<typeof c.apply.applyServerRows>[0][number]]);
  c.clock.advance(1_000);
}

test('createPet queues POST /pets and a complete local Pet with revision null', () => {
  const body = { name: 'New star', species: 'cat' as const };
  const id = c.mutations.createPet(body);
  const row: Pet = c.factory.pets({
    id, ...body, sex: 'unknown', created_by: c.sessionUser.id, revision: null,
  });
  expectMutation('pets', id, 'POST', '/pets', { id, ...body }, row);
  expect(c.store.getState().pets[id]).toEqual(row);
});

test('createPet preserves every optional request field in the full local row', () => {
  const body = {
    name: 'Star', species: 'dog' as const, sex: 'male' as const, breed: 'Mixed',
    color: 'Black', birthdate: '2020-01-02', microchip_id: 'chip',
    avatar_asset_id: c.ids.uuid(), notes: 'Gentle', sort_order: 4,
  };
  const id = c.mutations.createPet(body);
  expectMutation('pets', id, 'POST', '/pets', { id, ...body }, c.factory.pets({
    id, ...body, created_by: c.sessionUser.id, revision: null,
  }));
});

test('patchPet queues PATCH /pets/{id}, clears null and keeps revision', () => {
  const old = c.factory.pets({ revision: 27, notes: 'Old note' });
  seed('pets', old);
  const body = { name: 'Renamed', notes: null, sort_order: 3 };
  c.mutations.patchPet(old.id, body);
  const row: Pet = { ...old, ...body, updated_at: stamp(c) };
  expectMutation('pets', old.id, 'PATCH', `/pets/${old.id}`, body, row);
  expect(c.store.getState().pets[old.id]).toEqual(row);
});

test('archivePet queues its action with no body and keeps revision', () => {
  const old = c.factory.pets({ revision: 29 });
  seed('pets', old);
  c.mutations.archivePet(old.id);
  const row: Pet = { ...old, archived_at: stamp(c), updated_at: stamp(c) };
  expectMutation('pets', old.id, 'POST', `/pets/${old.id}/archive`, null, row);
});

test('unarchivePet queues its action with no body and keeps revision', () => {
  const old = c.factory.pets({ revision: 31, archived_at: stamp(c) });
  seed('pets', old);
  c.mutations.unarchivePet(old.id);
  const row: Pet = { ...old, archived_at: null, updated_at: stamp(c) };
  expectMutation('pets', old.id, 'POST', `/pets/${old.id}/unarchive`, null, row);
});

test('createWeight queues POST /weights and a complete local WeightEntry', () => {
  const body = { pet_id: c.factory.petId, weight_kg: 5.25, measured_at: stamp(c), note: 'Stable' };
  const id = c.mutations.createWeight(body);
  const row: WeightEntry = c.factory.weight_entries({ id, ...body, revision: null, created_by: c.sessionUser.id });
  expectMutation('weight_entries', id, 'POST', '/weights', { id, ...body }, row);
  expect(c.store.getState().weightEntries[id]).toEqual(row);
});

test('createWeight fills an omitted note with null locally', () => {
  const body = { pet_id: c.factory.petId, weight_kg: 4.25, measured_at: stamp(c) };
  const id = c.mutations.createWeight(body);
  expectMutation('weight_entries', id, 'POST', '/weights', { id, ...body }, c.factory.weight_entries({
    id, ...body, note: null, revision: null, created_by: c.sessionUser.id,
  }));
});

test('deleteWeight queues DELETE /weights/{id} and removes the local row', () => {
  const old = c.factory.weight_entries();
  seed('weight_entries', old);
  c.mutations.deleteWeight(old.id);
  expectMutation('weight_entries', old.id, 'DELETE', `/weights/${old.id}`, null, null);
  expect(c.store.getState().weightEntries[old.id]).toBeUndefined();
});

test('createHealthEvent queues POST /health-events and a complete HealthEvent', () => {
  const body = {
    pet_id: c.factory.petId, type: 'vaccine' as const, title: 'Vaccine',
    occurred_at: stamp(c), notes: 'Follow up', next_due_on: '2027-10-13',
    attachment_asset_id: c.ids.uuid(),
  };
  const id = c.mutations.createHealthEvent(body);
  const row: HealthEvent = c.factory.health_events({ id, ...body, revision: null, created_by: c.sessionUser.id });
  expectMutation('health_events', id, 'POST', '/health-events', { id, ...body }, row);
  expect(c.store.getState().healthEvents[id]).toEqual(row);
});

test('createHealthEvent fills nullable optional fields locally', () => {
  const body = { pet_id: c.factory.petId, type: 'symptom' as const, title: 'Cough', occurred_at: stamp(c) };
  const id = c.mutations.createHealthEvent(body);
  expectMutation('health_events', id, 'POST', '/health-events', { id, ...body }, c.factory.health_events({
    id, ...body, revision: null, created_by: c.sessionUser.id,
  }));
});

test('patchHealthEvent queues PATCH /health-events/{id} and keeps revision', () => {
  const old = c.factory.health_events({ revision: 33, next_due_on: '2027-10-13' });
  seed('health_events', old);
  const body = { title: 'Updated vaccine', next_due_on: null, attachment_asset_id: null };
  c.mutations.patchHealthEvent(old.id, body);
  const row: HealthEvent = { ...old, ...body, updated_at: stamp(c) };
  expectMutation('health_events', old.id, 'PATCH', `/health-events/${old.id}`, body, row);
  expect(c.store.getState().healthEvents[old.id]).toEqual(row);
});

test('deleteHealthEvent queues DELETE /health-events/{id} and removes locally', () => {
  const old = c.factory.health_events();
  seed('health_events', old);
  c.mutations.deleteHealthEvent(old.id);
  expectMutation('health_events', old.id, 'DELETE', `/health-events/${old.id}`, null, null);
  expect(c.store.getState().healthEvents[old.id]).toBeUndefined();
});

test('createTask queues POST /tasks and a complete local TaskTemplate', () => {
  const body: TaskCreate = {
    title: 'Medication', description: 'With food', category: 'medication',
    assigned_to: c.sessionUser.id, requires_photo: true, timer_seconds: 120,
    reminder_class: 'critical', sort_order: 2,
    recurrence: { freq: 'daily', interval: 2 }, times_of_day: ['08:00', '20:00'],
    starts_on: '2026-10-13', pet_ids: [c.factory.petId], completion_mode: 'per_pet',
    ends_on: '2026-11-13', replaces_task_id: null,
  };
  const id = c.mutations.createTask(body);
  const row: TaskTemplate = c.factory.task_templates({ id, ...body, revision: null, created_by: c.sessionUser.id });
  expectMutation('task_templates', id, 'POST', '/tasks', { id, ...body }, row);
  expect(c.store.getState().taskTemplates[id]).toEqual(row);
});

test('createTask fills the server defaults for omitted fields', () => {
  const body: TaskCreate = {
    title: 'Play', recurrence: { freq: 'daily', interval: 1 },
    starts_on: '2026-10-13', pet_ids: [c.factory.petId],
  };
  const id = c.mutations.createTask(body);
  expectMutation('task_templates', id, 'POST', '/tasks', { id, ...body }, c.factory.task_templates({
    id, ...body, category: 'other', times_of_day: [], revision: null, created_by: c.sessionUser.id,
  }));
});

test('patchTask queues PATCH /tasks/{id} with only the supplied fields', () => {
  const old = c.factory.task_templates({ revision: 37 });
  seed('task_templates', old);
  const body = { title: 'New title', assigned_to: null, ends_on: '2026-10-12' };
  c.mutations.patchTask(old.id, body);
  const row: TaskTemplate = { ...old, ...body, updated_at: stamp(c) };
  expectMutation('task_templates', old.id, 'PATCH', `/tasks/${old.id}`, body, row);
  expect(c.store.getState().taskTemplates[old.id]).toEqual(row);
});

test('deleteTask queues DELETE /tasks/{id} and removes the template locally', () => {
  const old = c.factory.task_templates();
  seed('task_templates', old);
  c.mutations.deleteTask(old.id);
  expectMutation('task_templates', old.id, 'DELETE', `/tasks/${old.id}`, null, null);
  expect(c.store.getState().taskTemplates[old.id]).toBeUndefined();
});

test('forkTask queues create before patch as one atomic store change', () => {
  const old = c.factory.task_templates({ revision: 41, recurrence: { freq: 'daily', interval: 3 } });
  seed('task_templates', old);
  const subscriber = jest.fn();
  c.store.subscribe(subscriber);
  const edits = { title: 'Forked title', times_of_day: ['10:00'] };
  const id = c.mutations.forkTask(old.id, edits, '2026-10-14');
  const fork = buildFork(old, edits, '2026-10-14', id);
  expect(queued(c)).toEqual([
    { seq: 1, entityId: id, method: 'POST', path: '/tasks', body: fork.newTemplate },
    { seq: 2, entityId: old.id, method: 'PATCH', path: `/tasks/${old.id}`, body: fork.oldPatch },
  ]);
  const row: TaskTemplate = {
    ...fork.newTemplate, created_by: c.sessionUser.id, revision: null,
    updated_at: stamp(c), deleted_at: null,
  };
  expect(c.replica.get('task_templates', id)?.row).toEqual(row);
  expect(c.replica.get('task_templates', old.id)?.row).toEqual({ ...old, ...fork.oldPatch, updated_at: stamp(c) });
  expect(c.store.getState().taskTemplates[id]).toEqual(row);
  expect(c.store.getState().taskTemplates[old.id]?.ends_on).toBe(fork.oldPatch.ends_on);
  expect(subscriber).toHaveBeenCalledTimes(1);
  expect(c.kick).toHaveBeenCalledTimes(1);
});

test('forkTask rolls back the new template when the old patch cannot queue', () => {
  const old = c.factory.task_templates({ revision: 43 });
  seed('task_templates', old);
  c.driver.run(`CREATE TRIGGER reject_fork_patch BEFORE INSERT ON outbox
    WHEN NEW.method = 'PATCH' BEGIN SELECT RAISE(ABORT, 'fork patch failed'); END`);
  const before = c.store.getState();
  const subscriber = jest.fn();
  c.store.subscribe(subscriber);
  expect(() => c.mutations.forkTask(old.id, { times_of_day: ['10:00'] }, '2026-10-14'))
    .toThrow('fork patch failed');
  expect(c.outbox.count()).toBe(0);
  expect(c.driver.all('SELECT id FROM replica WHERE entity = ?', ['task_templates'])).toEqual([{ id: old.id }]);
  expect(c.replica.get('task_templates', old.id)?.row).toEqual(old);
  expect(c.store.getState()).toBe(before);
  expect(subscriber).not.toHaveBeenCalled();
  expect(c.kick).not.toHaveBeenCalled();
});

test('createCompletion queues its wire body and snapshots the template title', () => {
  const template = c.factory.task_templates({ id: c.factory.taskId, title: 'Current title' });
  seed('task_templates', template);
  const body = {
    task_id: template.id, occurrence_key: '2026-10-13T08:00', pet_id: null,
    completed_at: stamp(c), photo_asset_id: c.ids.uuid(), note: 'Done',
  };
  const id = c.mutations.createCompletion(body);
  const row: Completion = c.factory.task_completions({
    id, ...body, completed_by: c.sessionUser.id, title_snapshot: template.title, revision: null,
  });
  expectMutation('task_completions', id, 'POST', '/completions', { id, ...body }, row);
  expect(c.store.getState().completions[id]).toEqual(row);
});

test('undoCompletion queues its action and preserves the revision and history', () => {
  const old = c.factory.task_completions({ revision: 47 });
  seed('task_completions', old);
  c.mutations.undoCompletion(old.id);
  const row: Completion = { ...old, undone_at: stamp(c), undone_by: c.sessionUser.id, updated_at: stamp(c) };
  expectMutation('task_completions', old.id, 'POST', `/completions/${old.id}/undo`, null, row);
  expect(c.store.getState().completions[old.id]).toEqual(row);
});

test('startTimer queues POST /timers and a complete local Timer', () => {
  const body = {
    task_id: c.factory.taskId, occurrence_key: '2026-10-13T08:00', pet_id: c.factory.petId,
    started_at: stamp(c), ends_at: new Date(c.clock.now() + 120_000).toISOString(),
  };
  const id = c.mutations.startTimer(body);
  const row: Timer = c.factory.task_timers({ id, ...body, started_by: c.sessionUser.id, revision: null });
  expectMutation('task_timers', id, 'POST', '/timers', { id, ...body }, row);
  expect(c.store.getState().timers[id]).toEqual(row);
});

test('startTimer fills an omitted pet_id with null locally', () => {
  const body = {
    task_id: c.factory.taskId, occurrence_key: '2026-10-13T08:00',
    started_at: stamp(c), ends_at: new Date(c.clock.now() + 60_000).toISOString(),
  };
  const id = c.mutations.startTimer(body);
  expectMutation('task_timers', id, 'POST', '/timers', { id, ...body }, c.factory.task_timers({
    id, ...body, pet_id: null, started_by: c.sessionUser.id, revision: null,
  }));
});

test('cancelTimer queues its action and keeps revision', () => {
  const old = c.factory.task_timers({ revision: 53 });
  seed('task_timers', old);
  c.mutations.cancelTimer(old.id);
  const row: Timer = { ...old, cancelled_at: stamp(c), updated_at: stamp(c) };
  expectMutation('task_timers', old.id, 'POST', `/timers/${old.id}/cancel`, null, row);
  expect(c.store.getState().timers[old.id]).toEqual(row);
});

test('startWalk queues POST /walks and a complete active Walk', () => {
  const body = { pet_id: c.factory.petId, started_at: stamp(c) };
  const id = c.mutations.startWalk(body);
  const row: Walk = c.factory.walk_sessions({ id, ...body, user_id: c.sessionUser.id, revision: null });
  expectMutation('walk_sessions', id, 'POST', '/walks', { id, ...body }, row);
  expect(c.store.getState().walks[id]).toEqual(row);
});

function finishBody(old: Walk): WalkFinish {
  return {
    pet_id: old.pet_id, started_at: old.started_at, ended_at: stamp(c), paused_ms: 1_000,
    distance_m: 500, duration_s: 300, avg_pace_s_per_km: 600, note: 'Nice walk',
    route: [[-23.55, -46.63, c.clock.now() - 300_000, 5], [-23.551, -46.631, c.clock.now(), 6]],
    preview: [[-23.55, -46.63], [-23.551, -46.631]],
  };
}

test('finishWalk queues the full wire route, stores only the Walk and keeps revision', () => {
  const old = c.factory.walk_sessions({ revision: 59 });
  seed('walk_sessions', old);
  const body = finishBody(old);
  c.mutations.finishWalk(old.id, body);
  const { route, ...fields } = body;
  const row: Walk = {
    ...old, ...fields, note: body.note ?? null, status: 'finished', point_count: route.length,
    has_route: true, updated_at: stamp(c),
  };
  expectMutation('walk_sessions', old.id, 'POST', `/walks/${old.id}/finish`, body, row);
  expect(c.store.getState().walks[old.id]).toEqual(row);
  expect(c.replica.get('walk_sessions', old.id)?.row).not.toHaveProperty('route');
});

test('finishWalk can create a local row without a preceding start', () => {
  const old = c.factory.walk_sessions();
  const body = { ...finishBody(old), route: [], preview: [] };
  c.mutations.finishWalk(old.id, body);
  const { route, ...fields } = body;
  const row: Walk = {
    ...old, ...fields, note: body.note ?? null, user_id: c.sessionUser.id, status: 'finished',
    point_count: route.length, has_route: false, revision: null, updated_at: stamp(c),
  };
  expectMutation('walk_sessions', old.id, 'POST', `/walks/${old.id}/finish`, body, row);
});

test('discardWalk queues its action and removes the Walk locally', () => {
  const old = c.factory.walk_sessions();
  seed('walk_sessions', old);
  c.mutations.discardWalk(old.id);
  expectMutation('walk_sessions', old.id, 'POST', `/walks/${old.id}/discard`, null, null);
  expect(c.store.getState().walks[old.id]).toBeUndefined();
});

test('enqueue is atomic across replica, outbox and store when the second insert throws', () => {
  const first = petMutation(c, 'First');
  const second = { ...petMutation(c, 'Second'), clientMutationId: first.clientMutationId };
  const before = c.store.getState();
  const subscriber = jest.fn();
  c.store.subscribe(subscriber);
  expect(() => c.mutations.enqueue(first, second)).toThrow(/UNIQUE/);
  expect(c.driver.all('SELECT * FROM replica')).toEqual([]);
  expect(c.outbox.count()).toBe(0);
  expect(c.store.getState()).toBe(before);
  expect(subscriber).not.toHaveBeenCalled();
  expect(c.kick).not.toHaveBeenCalled();
});

test('enqueue publishes both rows once and kicks synchronously after commit', () => {
  const first = petMutation(c, 'First');
  const second = petMutation(c, 'Second');
  const subscriber = jest.fn();
  c.store.subscribe(subscriber);
  const observed = jest.fn(() => {
    expect(c.outbox.count()).toBe(2);
    expect(c.store.getState().pets[first.entityId]).toEqual(first.localRow);
    expect(c.store.getState().pets[second.entityId]).toEqual(second.localRow);
  });
  const mutations = createMutations({
    driver: c.driver, apply: c.apply, clock: c.clock, ids: c.ids, sessionUser: c.sessionUser,
    kick: observed,
  });
  mutations.enqueue(first, second);
  expect(observed).toHaveBeenCalledTimes(1);
  expect(subscriber).toHaveBeenCalledTimes(1);
});

test('enqueue in an enclosing transaction waits for its commit to publish and kick', () => {
  const mutation = petMutation(c, 'Nested');
  c.driver.transaction(() => {
    c.mutations.enqueue(mutation);
    expect(c.outbox.count()).toBe(1);
    expect(c.store.getState().pets[mutation.entityId]).toBeUndefined();
    expect(c.kick).not.toHaveBeenCalled();
  });
  expect(c.store.getState().pets[mutation.entityId]).toEqual(mutation.localRow);
  expect(c.kick).toHaveBeenCalledTimes(1);
});

test('enqueue in an enclosing transaction discards its kick after rollback', () => {
  const mutation = petMutation(c, 'Rolled back');
  const before = c.store.getState();
  expect(() => c.driver.transaction(() => {
    c.mutations.enqueue(mutation);
    throw new Error('outer rollback');
  })).toThrow('outer rollback');
  expect(c.outbox.count()).toBe(0);
  expect(c.replica.get('pets', mutation.entityId)).toBeNull();
  expect(c.store.getState()).toBe(before);
  expect(c.kick).not.toHaveBeenCalled();
  c.driver.transaction(() => {});
  expect(c.kick).not.toHaveBeenCalled();
});

test.each([null, 61])('revision rule: patching an existing local row keeps %s', (revision) => {
  const old = c.factory.pets({ revision });
  c.apply.applyLocalRow('pets', old);
  c.mutations.patchPet(old.id, { name: 'Still local' });
  expect(c.replica.get('pets', old.id)?.row.revision).toBe(revision);
});

test.each([null, 63])('revision rule: archive and unarchive retain %s on a local pet', (revision) => {
  const old = c.factory.pets({ revision });
  c.apply.applyLocalRow('pets', old);
  c.mutations.archivePet(old.id);
  expect(c.replica.get('pets', old.id)?.row.revision).toBe(revision);
  c.mutations.unarchivePet(old.id);
  expect(c.replica.get('pets', old.id)?.row.revision).toBe(revision);
});

test.each([null, 65])('revision rule: undo retains %s on a local completion', (revision) => {
  const old = c.factory.task_completions({ revision });
  c.apply.applyLocalRow('task_completions', old);
  c.mutations.undoCompletion(old.id);
  expect(c.replica.get('task_completions', old.id)?.row.revision).toBe(revision);
});

test.each([null, 67])('revision rule: cancel retains %s on a local timer', (revision) => {
  const old = c.factory.task_timers({ revision });
  c.apply.applyLocalRow('task_timers', old);
  c.mutations.cancelTimer(old.id);
  expect(c.replica.get('task_timers', old.id)?.row.revision).toBe(revision);
});

test.each([null, 69])('revision rule: finish retains %s on a local walk', (revision) => {
  const old = c.factory.walk_sessions({ revision });
  c.apply.applyLocalRow('walk_sessions', old);
  c.mutations.finishWalk(old.id, finishBody(old));
  expect(c.replica.get('walk_sessions', old.id)?.row.revision).toBe(revision);
});

test('enqueue removes locally while its queued delete protects against a server apply', () => {
  const old = c.factory.pets();
  seed('pets', old);
  const mutation: Mutation = {
    clientMutationId: c.ids.uuid(), method: 'DELETE', path: `/pets/${old.id}`,
    body: null, entity: 'pets', entityId: old.id, localRow: null,
  };
  c.mutations.enqueue(mutation);
  c.apply.applyServerRows([{ entity: 'pets', row: old }]);
  expect(c.replica.get('pets', old.id)).toBeNull();
  expect(c.store.getState().pets[old.id]).toBeUndefined();
  expect(c.outbox.count()).toBe(1);
});
