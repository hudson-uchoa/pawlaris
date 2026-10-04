import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { buildDayView, type DayViewInput } from './dayView';
import type { Completion, Pet, TaskTemplate } from './entities';
import { localDate, slotInstant } from './time';

const date = '2026-10-07'; // Wednesday
const tz = 'America/Sao_Paulo';
const stamp = '2026-10-07T11:00:00Z';
const petIds = ['pet-a', 'pet-b', 'pet-c', 'pet-d'];

function pet(id: string, patch: Partial<Pet> = {}): Pet {
  return {
    id, name: id, species: 'cat', sex: 'unknown', breed: null, color: null,
    birthdate: null, microchip_id: null, avatar_asset_id: null, notes: null,
    sort_order: 0, archived_at: null, created_by: 'me', revision: 1,
    updated_at: stamp, deleted_at: null, ...patch,
  };
}

function template(patch: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: 'task', title: 'Breakfast', description: null, category: 'feeding',
    assigned_to: 'me', requires_photo: false, timer_seconds: null,
    reminder_class: 'routine', sort_order: 0, recurrence: { freq: 'daily', interval: 1 },
    times_of_day: ['08:00'], starts_on: '2026-09-01', pet_ids: petIds,
    completion_mode: 'together', ends_on: null, replaces_task_id: null,
    created_by: 'me', revision: 1, updated_at: stamp, deleted_at: null, ...patch,
  };
}

function completion(patch: Partial<Completion> = {}): Completion {
  return {
    id: 'completion', task_id: 'task', occurrence_key: `${date}T08:00`,
    pet_id: null, completed_by: 'other', completed_at: stamp,
    title_snapshot: 'Original breakfast', photo_asset_id: null, note: null,
    undone_at: null, undone_by: null, revision: 2, updated_at: stamp, ...patch,
  };
}

function perPetCompletions(count: number, key = `${date}T08:00`): Completion[] {
  return petIds.slice(0, count).map((id) => completion({
    id: `completion-${id}`, pet_id: id, occurrence_key: key,
  }));
}

function input(patch: Partial<DayViewInput> = {}): DayViewInput {
  return {
    date, now: slotInstant(date, '08:00', tz), tz, me: 'me', scope: 'mine',
    templates: [template()], completions: [], pets: petIds.map((id) => pet(id)),
    pendingCompletionIds: new Set<string>(), ...patch,
  };
}

const weekly = template({ recurrence: { freq: 'weekly', interval: 1, byday: ['MO'] } });
const mondayKey = '2026-10-05T08:00';

describe('day view', () => {
  it('DV-1 includes exactly sixty minutes before the slot in now', () => {
    const view = buildDayView(input({ now: slotInstant(date, '07:00', tz) }));
    expect(view.now).toHaveLength(1);
    expect(view.now[0]).toEqual({
      taskId: 'task', occurrenceKey: `${date}T08:00`, slotMs: slotInstant(date, '08:00', tz),
      originalDate: date, mode: 'together', pets: petIds.map((id) => pet(id)),
      progress: { done: 0, total: 1 }, completions: [], assignedTo: 'me',
      title: 'Breakfast', orphan: false,
    });
    expect(view.overdue).toEqual([]);
    expect(view.later).toEqual([]);
  });

  it('DV-2 places a slot sixty-one minutes away in later', () => {
    const view = buildDayView(input({ now: slotInstant(date, '06:59', tz) }));
    expect(view.later).toHaveLength(1);
    expect(view.now).toEqual([]);
  });

  it('DV-3 includes exactly sixty minutes after the slot in now', () => {
    const view = buildDayView(input({ now: slotInstant(date, '09:00', tz) }));
    expect(view.now).toHaveLength(1);
    expect(view.overdue).toEqual([]);
  });

  it('DV-4 places a slot sixty-one minutes ago in overdue', () => {
    const view = buildDayView(input({ now: slotInstant(date, '09:01', tz) }));
    expect(view.overdue).toHaveLength(1);
    expect(view.now).toEqual([]);
  });

  it('DV-5 puts incomplete all-day occurrences in now without a slot', () => {
    const view = buildDayView(input({ templates: [template({ times_of_day: [] })] }));
    expect(view.now).toHaveLength(1);
    expect(view.now[0]).toMatchObject({ occurrenceKey: date, slotMs: null });
  });

  it('DV-6 completes together occurrences with one live attributed row', () => {
    const row = completion({ photo_asset_id: 'photo', note: 'Given with food' });
    const view = buildDayView(input({ completions: [row] }));
    expect(view.done).toHaveLength(1);
    expect(view.done[0]).toMatchObject({ completions: [row], progress: { done: 1, total: 1 } });
    expect(view.now).toEqual([]);
  });

  it('DV-7 leaves partial per-pet progress in its time group', () => {
    const rows = perPetCompletions(2);
    const view = buildDayView(input({
      templates: [template({ completion_mode: 'per_pet' })], completions: rows,
    }));
    expect(view.now[0]).toMatchObject({ progress: { done: 2, total: 4 }, completions: rows });
    expect(view.done).toEqual([]);
  });

  it('DV-8 completes per-pet occurrences only when all four pets are done', () => {
    const view = buildDayView(input({
      templates: [template({ completion_mode: 'per_pet' })], completions: perPetCompletions(4),
    }));
    expect(view.done[0]).toMatchObject({ progress: { done: 4, total: 4 } });
    expect(view.now).toEqual([]);
  });

  it('DV-9 excludes archived pets from per-pet progress', () => {
    const rows = perPetCompletions(4);
    const view = buildDayView(input({
      templates: [template({ completion_mode: 'per_pet' })], completions: rows,
      pets: petIds.map((id) => pet(id, { archived_at: id === 'pet-d' ? stamp : null })),
    }));
    expect(view.done[0]).toMatchObject({
      progress: { done: 3, total: 3 }, pets: petIds.slice(0, 3).map((id) => pet(id)),
      completions: rows.slice(0, 3),
    });
  });

  it('DV-10 ignores undone rows and permits a new live completion', () => {
    const undone = completion({ undone_at: stamp, undone_by: 'me' });
    expect(buildDayView(input({ completions: [undone] })).now[0]?.progress.done).toBe(0);
    const live = completion({ id: 'redone' });
    expect(buildDayView(input({ completions: [undone, live] })).done[0]?.completions).toEqual([live]);
  });

  it('DV-11 includes only mine and unassigned templates in mine scope', () => {
    const view = buildDayView(input({ templates: [
      template(), template({ id: 'unassigned', assigned_to: null }),
      template({ id: 'other', assigned_to: 'other' }),
    ] }));
    expect(view.now.map((item) => item.taskId)).toEqual(['task', 'unassigned']);
    expect(view.now[1]?.assignedTo).toBeNull();
  });

  it('DV-12 includes every assignee in all scope', () => {
    const view = buildDayView(input({ scope: 'all', templates: [
      template(), template({ id: 'unassigned', assigned_to: null }),
      template({ id: 'other', assigned_to: 'other' }),
    ] }));
    expect(view.now.map((item) => item.taskId)).toEqual(['task', 'unassigned', 'other']);
  });

  it('DV-13 includes only the named user and excludes unassigned', () => {
    const view = buildDayView(input({ scope: 'user:other', templates: [
      template(), template({ id: 'unassigned', assigned_to: null }),
      template({ id: 'other', assigned_to: 'other' }),
    ] }));
    expect(view.now.map((item) => item.taskId)).toEqual(['other']);
  });

  it('DV-14 puts every incomplete past occurrence in overdue', () => {
    const view = buildDayView(input({ date: addDays(date, -1), templates: [
      template(), template({ id: 'all-day', times_of_day: [] }),
    ] }));
    expect(view.overdue).toHaveLength(2);
    expect(view.now).toEqual([]);
    expect(view.later).toEqual([]);
  });

  it('DV-15 puts future timed and all-day occurrences in later', () => {
    const view = buildDayView(input({ date: addDays(date, 1), templates: [
      template(), template({ id: 'all-day', times_of_day: [] }),
    ] }));
    expect(view.later).toHaveLength(2);
    expect(view.now).toEqual([]);
    expect(view.overdue).toEqual([]);
  });

  it('DV-16 carries only incomplete slots on the latest missed non-daily date', () => {
    const view = buildDayView(input({ templates: [
      { ...weekly, times_of_day: ['08:00', '20:00'] },
    ], completions: [completion({ occurrence_key: mondayKey })] }));
    expect(view.overdue.map((item) => item.occurrenceKey)).toEqual(['2026-10-05T20:00']);
    expect(view.overdue[0]).toMatchObject({ originalDate: '2026-10-05', orphan: false });
    const monthly = template({
      recurrence: { freq: 'monthly', interval: 1, bymonthday: [1, 5] }, times_of_day: [],
    });
    expect(buildDayView(input({ templates: [monthly] })).overdue.map((item) => item.originalDate))
      .toEqual(['2026-10-05']);
  });

  it('DV-17 stops carrying a completed missed occurrence', () => {
    const view = buildDayView(input({
      templates: [weekly], completions: [completion({ occurrence_key: mondayKey })],
    }));
    expect(view).toEqual({ overdue: [], now: [], later: [], done: [], allDone: false });
    expect(buildDayView(input({ templates: [template({
      recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'TH'] },
    })] })).overdue).toHaveLength(1);
  });

  it('DV-18 suppresses carry-over when the template occurs today', () => {
    const view = buildDayView(input({ templates: [template({
      recurrence: { freq: 'weekly', interval: 1, byday: ['MO', 'WE'] },
    })] }));
    expect(view.overdue).toEqual([]);
    expect(view.now.map((item) => item.occurrenceKey)).toEqual([`${date}T08:00`]);
  });

  it('DV-19 never carries missed daily occurrences', () => {
    const view = buildDayView(input());
    expect(view.overdue).toEqual([]);
    expect(view.now.map((item) => item.originalDate)).toEqual([date]);
  });

  it('DV-20 includes thirty days ago and excludes thirty-one days ago', () => {
    function once(daysAgo: number): TaskTemplate {
      const originalDate = addDays(date, -daysAgo);
      return template({
        id: `once-${daysAgo}`, starts_on: originalDate,
        recurrence: { freq: 'once', date: originalDate },
      });
    }
    const view = buildDayView(input({ templates: [once(30), once(31)] }));
    expect(view.overdue.map((item) => item.taskId)).toEqual(['once-30']);
    expect(view.overdue[0]?.originalDate).toBe('2026-09-07');
  });

  it('DV-21 never carries over when viewing another day', () => {
    for (const viewedDate of ['2026-10-06', '2026-10-08']) {
      expect(buildDayView(input({ date: viewedDate, templates: [weekly] })))
        .toEqual({ overdue: [], now: [], later: [], done: [], allDone: false });
    }
  });

  it('DV-22 prefers acknowledged rows regardless of replica order', () => {
    const acknowledged = completion();
    const pending = completion({ id: 'pending', revision: null, completed_by: 'me' });
    for (const rows of [[pending, acknowledged], [acknowledged, pending]]) {
      const view = buildDayView(input({ completions: rows, pendingCompletionIds: new Set(['pending']) }));
      expect(view.done[0]?.completions).toEqual([acknowledged]);
    }
    expect(buildDayView(input({ completions: [pending], pendingCompletionIds: new Set(['pending']) }))
      .done[0]?.completions).toEqual([pending]);
  });

  it('DV-23 orders groups by slot, sort order, then title without changing input', () => {
    const templates = [
      template({ id: 'z', title: 'Zulu', sort_order: 2 }),
      template({ id: 'a', title: 'Alpha', sort_order: 2 }),
      template({ id: 'order', title: 'Third', sort_order: 1 }),
    ];
    expect(buildDayView(input({ templates })).now.map((item) => item.taskId)).toEqual(['order', 'a', 'z']);
    const mixed = [
      template({ id: 'later', times_of_day: ['09:00'], sort_order: -1 }),
      template({ id: 'earlier', times_of_day: ['07:00'], sort_order: 3 }),
      template({ id: 'all-day', times_of_day: [] }),
    ];
    expect(buildDayView(input({ templates: mixed })).now.map((item) => item.taskId))
      .toEqual(['all-day', 'earlier', 'later']);
    expect(templates.map((task) => task.id)).toEqual(['z', 'a', 'order']);
    expect(mixed.map((task) => task.id)).toEqual(['later', 'earlier', 'all-day']);
  });

  it('DV-24 excludes deleted, ended, and wholly archived scheduled templates', () => {
    const view = buildDayView(input({ templates: [
      template({ id: 'deleted', deleted_at: stamp }),
      template({ id: 'ended', ends_on: addDays(date, -1) }),
      template({ id: 'archived', pet_ids: ['archived'] }),
    ], pets: [pet('archived', { archived_at: stamp })] }));
    expect(view).toEqual({ overdue: [], now: [], later: [], done: [], allDone: false });
  });

  it('DV-25 uses the family-local day across UTC midnight', () => {
    const now = Date.parse('2026-10-04T02:30:00Z');
    const viewedDate = localDate(now, tz);
    expect(viewedDate).toBe('2026-10-03');
    const view = buildDayView(input({ date: viewedDate, now, templates: [
      template({ times_of_day: ['23:00'] }),
    ] }));
    expect(view.now[0]).toMatchObject({ originalDate: '2026-10-03', occurrenceKey: '2026-10-03T23:00' });
  });

  it('DV-26 requires at least one item and every scoped item done for allDone', () => {
    expect(buildDayView(input({ templates: [] })).allDone).toBe(false);
    expect(buildDayView(input({ completions: [completion()] })).allDone).toBe(true);
    expect(buildDayView(input()).allDone).toBe(false);
    expect(buildDayView(input({ completions: [completion()], templates: [template(),
      template({ id: 'other', assigned_to: 'other' }),
    ] })).allDone).toBe(true);
    expect(buildDayView(input({ completions: [completion()], templates: [template(),
      { ...weekly, id: 'missed' },
    ] })).allDone).toBe(false);
  });

  it('DV-27 retains orphan completions with snapshot titles and original scope', () => {
    const old = template({ ends_on: addDays(date, -1) });
    const row = completion();
    const view = buildDayView(input({ templates: [old], completions: [row] }));
    expect(view.done).toHaveLength(1);
    expect(view.done[0]).toMatchObject({
      taskId: old.id, occurrenceKey: row.occurrence_key, title: row.title_snapshot,
      originalDate: date, orphan: true, completions: [row], progress: { done: 1, total: 1 },
    });
    expect(buildDayView(input({ templates: [{ ...old, assigned_to: 'other' }], completions: [row] }))
      .done).toEqual([]);
    expect(buildDayView(input({ templates: [old], completions: [completion({ undone_at: stamp })] }))
      .done).toEqual([]);
    const partial = buildDayView(input({ templates: [{ ...old, completion_mode: 'per_pet' }],
      completions: perPetCompletions(2),
    }));
    expect(partial.done).toHaveLength(1);
    expect(partial.done[0]?.completions).toHaveLength(2);
    const allDay = buildDayView(input({ templates: [old], completions: [completion({ occurrence_key: date })] }));
    expect(allDay.done[0]?.slotMs).toBeNull();
  });

  it('DV-28 counts matching predecessor completions for successor occurrences', () => {
    const old = template({ ends_on: addDays(date, -1) });
    const successor = template({ id: 'new', starts_on: date, replaces_task_id: old.id });
    const row = completion();
    const view = buildDayView(input({ templates: [old, successor], completions: [row] }));
    expect(view.done).toHaveLength(1);
    expect(view.done[0]).toMatchObject({ taskId: 'new', orphan: false, completions: [row] });
    expect(view.now).toEqual([]);
    const perPetOld = { ...old, completion_mode: 'per_pet' as const };
    const perPetNew = { ...successor, completion_mode: 'per_pet' as const };
    const rows = perPetCompletions(4);
    expect(buildDayView(input({ templates: [perPetOld, perPetNew], completions: rows })).done[0])
      .toMatchObject({ taskId: 'new', orphan: false, progress: { done: 4, total: 4 }, completions: rows });
    const changedSlot = buildDayView(input({ templates: [old, { ...successor, times_of_day: ['09:00'] }],
      completions: [row],
    }));
    expect(changedSlot.done[0]?.orphan).toBe(true);
    expect(changedSlot.now[0]?.progress.done).toBe(0);
    const changedPet = buildDayView(input({ templates: [perPetOld, { ...perPetNew, pet_ids: ['pet-d'] }],
      completions: perPetCompletions(1),
    }));
    expect(changedPet.done[0]?.orphan).toBe(true);
    expect(changedPet.now[0]?.progress.done).toBe(0);
  });
});
