import { buildDayView } from '@pawlaris/shared';
import {
  selectCompletionsForRange, selectDayView, selectMe, selectMembers,
  selectPet, selectPets, selectTemplates, selectWalks,
} from '../selectors';
import { replicaContext, type ReplicaContext } from './support';

let context: ReplicaContext | undefined;
beforeEach(async () => { context = await replicaContext(); });
afterEach(() => { context?.driver.close(); context = undefined; });

function current(): ReplicaContext {
  if (context === undefined) throw new Error('Replica test context is missing');
  return context;
}

test('P3-2 selectors: pets, members, templates and walks come from their replica slices', () => {
  const { factory, apply, store } = current();
  const pet = factory.pets();
  const member = factory.members();
  const template = factory.task_templates();
  const walk = factory.walk_sessions();
  apply.applyServerRows([
    { entity: 'pets', row: pet }, { entity: 'members', row: member },
    { entity: 'task_templates', row: template }, { entity: 'walk_sessions', row: walk },
  ]);
  const state = store.getState();
  expect(selectPets(state)).toEqual([pet]);
  expect(selectPet(state, pet.id)).toEqual(pet);
  expect(selectPet(state, 'missing')).toBeNull();
  expect(selectMembers(state)).toEqual([member]);
  expect(selectMe(state, member.id)).toEqual(member);
  expect(selectMe(state, 'missing')).toBeNull();
  expect(selectTemplates(state)).toEqual([template]);
  expect(selectWalks(state)).toEqual([walk]);
});

test('P3-2 selectors: empty slices yield empty lists and missing identities yield null', () => {
  const state = current().store.getState();
  expect(selectPets(state)).toEqual([]);
  expect(selectPet(state, 'missing')).toBeNull();
  expect(selectMembers(state)).toEqual([]);
  expect(selectMe(state, 'missing')).toBeNull();
  expect(selectTemplates(state)).toEqual([]);
  expect(selectWalks(state)).toEqual([]);
  expect(selectCompletionsForRange(state, '2026-10-01', '2026-10-31')).toEqual([]);
});

test('P3-2 completion range: both boundary keys are included and outside keys are excluded', () => {
  const { factory, apply, store } = current();
  const before = factory.task_completions({ occurrence_key: '2026-10-10T07:59' });
  const first = factory.task_completions({ occurrence_key: '2026-10-10T08:00' });
  const last = factory.task_completions({ occurrence_key: '2026-10-12T20:00' });
  const after = factory.task_completions({ occurrence_key: '2026-10-12T20:01' });
  apply.applyServerRows([after, last, first, before].map((row) => ({ entity: 'task_completions', row })));
  expect(selectCompletionsForRange(store.getState(), '2026-10-10T08:00', '2026-10-12T20:00'))
    .toEqual(expect.arrayContaining([first, last]));
  expect(selectCompletionsForRange(store.getState(), '2026-10-10T08:00', '2026-10-12T20:00'))
    .toHaveLength(2);
});

test('P3-2 day view: the selector wraps the real builder with family timezone and pending ids', () => {
  const ctx = current();
  const family = ctx.factory.family();
  const pet = ctx.factory.pets({ id: ctx.factory.petId });
  const template = ctx.factory.task_templates({ id: ctx.factory.taskId });
  const pending = ctx.factory.task_completions({ revision: null });
  const acknowledged = ctx.factory.task_completions({ completed_by: ctx.ids.uuid() });
  ctx.apply.applyServerRows([
    { entity: 'family', row: family }, { entity: 'pets', row: pet },
    { entity: 'task_templates', row: template }, { entity: 'task_completions', row: acknowledged },
  ]);
  ctx.apply.applyLocalRow('task_completions', pending);
  const options = {
    date: '2026-10-13' as const, now: ctx.clock.now(), me: ctx.factory.memberId, scope: 'mine' as const,
  };
  const before = ctx.store.getState();
  const expected = buildDayView({
    ...options, tz: family.timezone, pets: [pet], templates: [template],
    completions: [pending, acknowledged], pendingCompletionIds: new Set([pending.id]),
  });
  const view = selectDayView(before, options);
  expect(view).toEqual(expected);
  expect(view.done[0]?.completions).toEqual([acknowledged]);
  expect(ctx.store.getState()).toBe(before);
});

test('P3-2 tombstone selectors: deleted pets, members, templates and walks never appear', () => {
  const ctx = current();
  const deleted_at = new Date(ctx.clock.now()).toISOString();
  ctx.apply.applyServerRows([
    { entity: 'pets', row: ctx.factory.pets({ deleted_at }) },
    { entity: 'members', row: ctx.factory.members({ deleted_at }) },
    { entity: 'task_templates', row: ctx.factory.task_templates({ deleted_at }) },
    { entity: 'walk_sessions', row: ctx.factory.walk_sessions({ deleted_at }) },
  ]);
  const state = ctx.store.getState();
  expect(selectPets(state)).toEqual([]);
  expect(selectMembers(state)).toEqual([]);
  expect(selectTemplates(state)).toEqual([]);
  expect(selectWalks(state)).toEqual([]);
});
