import type { Completion, HealthEvent, TaskTemplate } from '@pawlaris/shared';
import { selectPetHealthTimeline } from '../../health/petHealthTimeline';
import { petContext, type PetContext } from './support';

let context: PetContext | undefined;

afterEach(() => {
  context?.dispose();
  context = undefined;
});

async function scene() {
  const c = await petContext();
  context = c;
  const pet = c.seedPet();
  const otherPet = c.seedPet({ name: 'Atlas' });
  const member = c.factory.members({ display_name: 'Duda' });
  c.driver.transaction(() => { c.apply.applyLocalRow('members', member); });
  return { c, pet, otherPet, member };
}

function seedCare(c: PetContext, taskFields: Partial<TaskTemplate>, completionFields: Partial<Completion> = {}) {
  const task = c.factory.task_templates({ category: 'vet', completion_mode: 'per_pet',
    starts_on: '2026-09-01', ...taskFields });
  const completion = c.factory.task_completions({ task_id: task.id,
    title_snapshot: 'Recorded treatment', ...completionFields });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('task_templates', task);
    c.apply.applyLocalRow('task_completions', completion);
  });
  return { task, completion };
}

function seedEvent(c: PetContext, fields: Partial<HealthEvent>) {
  const event = c.factory.health_events(fields);
  c.driver.transaction(() => { c.apply.applyLocalRow('health_events', event); });
  return event;
}

test.each(['vet', 'medication'] as const)(
  'R2.14 live per_pet %s care retains the snapshot, member and completion time', async (category) => {
    const { c, pet, member } = await scene();
    const { task, completion } = seedCare(c, { category, pet_ids: [pet.id], title: 'Renamed task' }, {
      pet_id: pet.id, completed_by: member.id, completed_at: '2026-10-12T11:02:00.000Z',
      occurrence_key: '2026-10-11T08:00', title_snapshot: 'Original treatment',
    });
    expect(selectPetHealthTimeline(c.store.getState(), pet.id)).toEqual([
      { month: '2026-10', entries: [{ kind: 'care', task, completion, member }] },
    ]);
    expect(c.http.requests).toEqual([]);
    expect(c.outbox.count()).toBe(0);
  },
);

test.each(['undone', 'other per_pet pet', 'feeding', 'unrelated together task'] as const)(
  'R2.14 excludes %s while retaining live care for the profile pet', async (excluded) => {
    const { c, pet, otherPet, member } = await scene();
    const kept = seedCare(c, { pet_ids: [pet.id] }, { pet_id: pet.id, completed_by: member.id });
    seedCare(c, {
      pet_ids: excluded === 'unrelated together task' ? [otherPet.id] : [pet.id, otherPet.id],
      completion_mode: excluded === 'unrelated together task' ? 'together' : 'per_pet',
      category: excluded === 'feeding' ? 'feeding' : 'vet',
    }, {
      completed_by: member.id,
      pet_id: excluded === 'unrelated together task' ? null : excluded === 'other per_pet pet' ? otherPet.id : pet.id,
      ...(excluded === 'undone' ? {
        undone_at: new Date(c.clock.now()).toISOString(), undone_by: member.id,
      } : {}),
    });
    expect(selectPetHealthTimeline(c.store.getState(), pet.id)).toEqual([
      { month: '2026-10', entries: [{ kind: 'care', ...kept, member }] },
    ]);
    expect(c.http.requests).toEqual([]);
  },
);

test('R2.14 a together completion covers every pet selected on the task', async () => {
  const { c, pet, otherPet, member } = await scene();
  const care = seedCare(c, { pet_ids: [pet.id, otherPet.id], completion_mode: 'together' }, {
    pet_id: null, completed_by: member.id,
  });
  for (const petId of [pet.id, otherPet.id]) {
    expect(selectPetHealthTimeline(c.store.getState(), petId)).toEqual([
      { month: '2026-10', entries: [{ kind: 'care', ...care, member }] },
    ]);
  }
  expect(c.http.requests).toEqual([]);
});

test('R2.12 R2.14 merge events and completed care newest first in family timezone months', async () => {
  const { c, pet, otherPet, member } = await scene();
  const older = seedEvent(c, { pet_id: pet.id, occurred_at: '2026-09-15T12:00:00.000Z' });
  const newest = seedEvent(c, { pet_id: pet.id, occurred_at: '2026-10-12T12:00:00.000Z' });
  const care = seedCare(c, { pet_ids: [pet.id] }, { pet_id: pet.id, completed_by: member.id,
    completed_at: '2026-10-01T01:30:00.000Z', occurrence_key: '2026-09-10T08:00' });
  const middle = seedEvent(c, { pet_id: pet.id, occurred_at: '2026-09-25T12:00:00.000Z' });
  seedEvent(c, { pet_id: otherPet.id, occurred_at: '2026-10-13T12:00:00.000Z' });
  seedEvent(c, { pet_id: pet.id, deleted_at: new Date(c.clock.now()).toISOString() });
  expect(selectPetHealthTimeline(c.store.getState(), pet.id)).toEqual([
    { month: '2026-10', entries: [{ kind: 'event', event: newest }] },
    { month: '2026-09', entries: [
      { kind: 'care', ...care, member },
      { kind: 'event', event: middle },
      { kind: 'event', event: older },
    ] },
  ]);
  expect(c.http.requests).toEqual([]);
});
