import { describe, expect, it } from 'vitest';
import type { Completion, TaskTemplate } from './entities';
import {
  buildEnd, buildFork, classifyTaskEdit, COSMETIC_FIELDS, forkEffectiveDate,
  SCHEDULE_FIELDS, type TaskEdits,
} from './taskEdit';

const today = '2026-10-07'; // Wednesday
const stamp = '2026-10-07T11:00:00Z';

function template(patch: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: 'task', title: 'Breakfast', description: 'Serve after the walk',
    category: 'feeding', assigned_to: 'member', requires_photo: true,
    timer_seconds: 300, reminder_class: 'routine', sort_order: 4,
    recurrence: { freq: 'daily', interval: 1 }, times_of_day: ['08:00', '20:00'],
    starts_on: '2026-09-01', pet_ids: ['pet-a', 'pet-b'],
    completion_mode: 'together', ends_on: '2026-12-31', replaces_task_id: 'previous',
    created_by: 'creator', revision: 7, updated_at: stamp, deleted_at: null,
    ...patch,
  };
}

function completion(patch: Partial<Completion> = {}): Completion {
  return {
    id: 'completion', task_id: 'task', occurrence_key: `${today}T08:00`,
    pet_id: null, completed_by: 'member', completed_at: stamp,
    title_snapshot: 'Original breakfast', photo_asset_id: null, note: null,
    undone_at: null, undone_by: null, revision: 8, updated_at: stamp, ...patch,
  };
}

describe('task edits and forks', () => {
  it('FK-1 classifies cosmetic-only and unchanged edits in place', () => {
    const old = template();
    const edits: TaskEdits = {
      title: 'Dinner', description: null, category: 'medication', assigned_to: null,
      requires_photo: false, timer_seconds: null, reminder_class: 'critical', sort_order: 0,
    };
    expect(COSMETIC_FIELDS).toEqual([
      'title', 'description', 'category', 'assigned_to', 'requires_photo',
      'timer_seconds', 'reminder_class', 'sort_order',
    ]);
    for (const field of COSMETIC_FIELDS) {
      expect(classifyTaskEdit(old, { [field]: edits[field] })).toBe('cosmetic');
    }
    expect(classifyTaskEdit(old, edits)).toBe('cosmetic');
    expect(classifyTaskEdit(old, {})).toBe('cosmetic');
    expect(classifyTaskEdit(old, {
      recurrence: { interval: 1, freq: 'daily' }, times_of_day: ['08:00', '20:00'],
      pet_ids: ['pet-a', 'pet-b'], starts_on: old.starts_on,
      completion_mode: old.completion_mode, title: 'Dinner',
    })).toBe('cosmetic');
    const weekly = template({ recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'WE'] } });
    const monthly = template({ recurrence: { freq: 'monthly', interval: 1, bymonthday: [1, 15] } });
    const oldBefore = structuredClone([old, weekly, monthly]);
    const reordered: [TaskEdits, TaskEdits, TaskEdits] = [
      { pet_ids: ['pet-b', 'pet-a'], title: 'Dinner' },
      { recurrence: { freq: 'weekly', interval: 1, byday: ['WE', 'MO'] } },
      { recurrence: { freq: 'monthly', interval: 1, bymonthday: [15, 1] } },
    ];
    const editsBefore = structuredClone(reordered);
    expect.soft(classifyTaskEdit(old, reordered[0])).toBe('cosmetic');
    expect.soft(classifyTaskEdit(weekly, reordered[1])).toBe('cosmetic');
    expect.soft(classifyTaskEdit(monthly, reordered[2])).toBe('cosmetic');
    expect([old, weekly, monthly]).toEqual(oldBefore);
    expect(reordered).toEqual(editsBefore);
  });

  it('FK-2 classifies each changed schedule field and mixed edits as a fork', () => {
    const old = template();
    expect(SCHEDULE_FIELDS).toEqual([
      'recurrence', 'times_of_day', 'starts_on', 'pet_ids', 'completion_mode',
    ]);
    const edits: TaskEdits[] = [
      { recurrence: { freq: 'daily', interval: 2 } },
      { recurrence: { freq: 'weekly', interval: 1, byday: ['WE'] } },
      { times_of_day: ['09:00', '20:00'] }, { times_of_day: [] },
      { starts_on: '2026-10-12' }, { pet_ids: ['pet-b'] },
      { pet_ids: ['pet-a', 'pet-c'] },
      { completion_mode: 'per_pet' },
    ];
    for (const edit of edits) {
      expect(classifyTaskEdit(old, edit)).toBe('schedule');
      expect(classifyTaskEdit(old, { ...edit, title: 'Dinner' })).toBe('schedule');
    }
    const weekly = template({ recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'WE'] } });
    expect(classifyTaskEdit(weekly, {
      recurrence: { byday: ['MO', 'WE'], interval: 1, freq: 'weekly' },
    })).toBe('cosmetic');
    expect(classifyTaskEdit(weekly, {
      recurrence: { freq: 'weekly', interval: 1, byday: ['FR'] },
    })).toBe('schedule');
    expect(classifyTaskEdit(weekly, {
      recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'FR'] },
    })).toBe('schedule');
    const monthly = template({ recurrence: { freq: 'monthly', interval: 1, bymonthday: [1, 15] } });
    expect(classifyTaskEdit(monthly, {
      recurrence: { freq: 'monthly', interval: 1, bymonthday: [1, 20] },
    })).toBe('schedule');
  });

  it('FK-3 uses today without a live completion for a generated occurrence', () => {
    const old = template();
    expect(forkEffectiveDate({ template: old, completions: [], today })).toBe(today);
    const unrelated = [
      completion({ task_id: 'other-task' }),
      completion({ occurrence_key: '2026-10-06T08:00' }),
      completion({ occurrence_key: '2026-10-08T08:00' }),
      completion({ occurrence_key: `${today}T09:00` }),
      completion({ occurrence_key: today }),
    ];
    for (const row of unrelated) {
      expect(forkEffectiveDate({ template: old, completions: [row], today })).toBe(today);
    }
    expect(forkEffectiveDate({
      template: template({ recurrence: { freq: 'weekly', interval: 1, byday: ['MO'] } }),
      completions: [completion()], today,
    })).toBe(today);
    expect(forkEffectiveDate({
      template: template({ ends_on: '2026-10-06' }), completions: [completion()], today,
    })).toBe(today);
  });

  it('FK-4 uses tomorrow for even one live completion keyed to today', () => {
    const old = template();
    expect(forkEffectiveDate({
      template: old, completions: [completion({ completed_at: '2026-10-08T01:00:00Z' })], today,
    })).toBe('2026-10-08');
    expect(forkEffectiveDate({
      template: template({ completion_mode: 'per_pet' }),
      completions: [completion({ pet_id: 'pet-a', occurrence_key: `${today}T20:00` })], today,
    })).toBe('2026-10-08');
    expect(forkEffectiveDate({
      template: template({ times_of_day: [] }),
      completions: [completion({ occurrence_key: today })], today,
    })).toBe('2026-10-08');
  });

  it('FK-5 ignores undone completions but retains any live one', () => {
    const undone = completion({ undone_at: stamp, undone_by: 'member' });
    expect(forkEffectiveDate({ template: template(), completions: [undone], today })).toBe(today);
    expect(forkEffectiveDate({
      template: template(), completions: [undone, completion({ id: 'live' })], today,
    })).toBe('2026-10-08');
  });

  it('FK-6 builds the successor payload and end patch without rewriting history', () => {
    const old = template();
    const edits: TaskEdits = {
      title: 'Dinner', times_of_day: ['19:00'], pet_ids: ['pet-b'],
      completion_mode: 'per_pet', starts_on: '2026-10-01',
    };
    const oldBefore = structuredClone(old);
    const editsBefore = structuredClone(edits);
    const past = completion({ occurrence_key: '2026-10-06T08:00' });
    const pastBefore = structuredClone(past);
    const E = forkEffectiveDate({ template: old, completions: [past], today });
    expect(buildFork(old, edits, E, 'successor')).toEqual({
      newTemplate: {
        id: 'successor', title: 'Dinner', description: 'Serve after the walk',
        category: 'feeding', assigned_to: 'member', requires_photo: true,
        timer_seconds: 300, reminder_class: 'routine', sort_order: 4,
        recurrence: { freq: 'daily', interval: 1 }, times_of_day: ['19:00'],
        starts_on: today, pet_ids: ['pet-b'], completion_mode: 'per_pet',
        ends_on: '2026-12-31', replaces_task_id: 'task',
      },
      oldPatch: { ends_on: '2026-10-06' },
    });
    expect(buildFork(old, {
      description: null, category: 'other', assigned_to: null, requires_photo: false,
      timer_seconds: null, reminder_class: 'critical', sort_order: 0,
      recurrence: { freq: 'weekly', interval: 2, byday: ['MO'] },
    }, E, 'successor').newTemplate).toMatchObject({
      description: null, category: 'other', assigned_to: null, requires_photo: false,
      timer_seconds: null, reminder_class: 'critical', sort_order: 0,
      recurrence: { freq: 'weekly', interval: 2, byday: ['MO'] },
      title: old.title, times_of_day: old.times_of_day, pet_ids: old.pet_ids,
    });
    expect(old).toEqual(oldBefore);
    expect(edits).toEqual(editsBefore);
    expect(past).toEqual(pastBefore);
  });

  it('FK-7 starts a once successor on its new recurrence date', () => {
    const old = template({ recurrence: { freq: 'once', date: today }, starts_on: today });
    const edits: TaskEdits = { recurrence: { freq: 'once', date: '2026-10-20' } };
    const fork = buildFork(old, edits, today, 'successor');
    expect(fork.newTemplate.starts_on).toBe('2026-10-20');
    expect(fork.newTemplate.recurrence).toEqual({ freq: 'once', date: '2026-10-20' });
    expect(fork.oldPatch).toEqual({ ends_on: '2026-10-06' });
    expect(old.starts_on).toBe(today);
    expect(old.recurrence).toEqual({ freq: 'once', date: today });
  });

  it('FK-8 ends before E without extending an earlier end date', () => {
    const old = template();
    const before = structuredClone(old);
    expect(buildEnd(old, today)).toEqual({ ends_on: '2026-10-06' });
    expect(buildEnd(old, '2026-11-01')).toEqual({ ends_on: '2026-10-31' });
    expect(buildEnd(old, '2027-01-01')).toEqual({ ends_on: '2026-12-31' });
    expect.soft(buildEnd(old, '2028-03-01')).toEqual({ ends_on: '2026-12-31' });
    expect(buildEnd(template({ ends_on: null }), '2028-03-01')).toEqual({ ends_on: '2028-02-29' });
    const ended = template({ ends_on: '2026-10-03' });
    const endedBefore = structuredClone(ended);
    expect.soft(buildEnd(ended, today)).toEqual({ ends_on: '2026-10-03' });
    expect(buildEnd(template({ ends_on: '2026-10-06' }), today)).toEqual({ ends_on: '2026-10-06' });
    expect(ended).toEqual(endedBefore);
    expect(old).toEqual(before);
  });

  it('FK-9 never moves a future template before its original start', () => {
    const old = template({ starts_on: '2026-10-12' });
    const E = forkEffectiveDate({ template: old, completions: [], today });
    expect(E).toBe('2026-10-12');
    expect(forkEffectiveDate({ template: old, completions: [completion()], today })).toBe(E);
    expect(buildFork(old, { times_of_day: ['09:00'] }, E, 'successor').newTemplate.starts_on).toBe(E);
    expect(buildEnd(old, E)).toEqual({ ends_on: '2026-10-11' });
  });

  it('FK-10 keeps the daily cycle on an off day and an on day', () => {
    const old = template({
      recurrence: { freq: 'daily', interval: 3 }, starts_on: '2026-10-01',
    });
    for (const E of ['2026-10-05', '2026-10-07']) {
      const fork = buildFork(old, { times_of_day: ['09:00'] }, E, 'successor');
      expect(fork.newTemplate.starts_on).toBe('2026-10-07');
    }
  });

  it('FK-11 keeps the weekly cycle on an off week and within an on week', () => {
    const old = template({
      recurrence: { freq: 'weekly', interval: 2, byday: ['MO'] }, starts_on: '2026-09-28',
    });
    for (const [E, startsOn] of [
      ['2026-10-07', '2026-10-12'], ['2026-10-14', '2026-10-14'],
    ] as const) {
      const fork = buildFork(old, { times_of_day: ['09:00'] }, E, 'successor');
      expect(fork.newTemplate.starts_on).toBe(startsOn);
    }
  });

  it('FK-12 keeps the monthly cycle on an off month and within an on month', () => {
    const old = template({
      recurrence: { freq: 'monthly', interval: 3, bymonthday: [5] }, starts_on: '2026-08-05',
    });
    for (const [E, startsOn] of [
      ['2026-10-07', '2026-11-01'], ['2026-11-20', '2026-11-20'],
    ] as const) {
      const fork = buildFork(old, { times_of_day: ['09:00'] }, E, 'successor');
      expect(fork.newTemplate.starts_on).toBe(startsOn);
    }
  });

  it('FK-13 starts a changed interval or frequency at the effective date', () => {
    const old = template({
      recurrence: { freq: 'daily', interval: 3 }, starts_on: '2026-10-01',
    });
    const edits: TaskEdits[] = [
      { recurrence: { freq: 'daily', interval: 2 } },
      { recurrence: { freq: 'weekly', interval: 3, byday: ['MO'] } },
    ];
    for (const edit of edits) {
      const fork = buildFork(old, edit, '2026-10-05', 'successor');
      expect(fork.newTemplate.starts_on).toBe('2026-10-05');
    }
  });
});
