import { describe, expect, it } from 'vitest';
import type { Completion, HealthEvent, Pet, TaskTemplate, Timer } from './entities';
import { planReminders, type ReminderInput, type ReminderItem } from './reminders';

const today = '2026-10-07';
const stamp = '2026-10-07T10:00:00Z'; // 07:00 in the family timezone.
const now = Date.parse(stamp);
const slot = Date.parse('2026-10-07T11:00:00Z');
const reminderId = `rem:task:${today}T08:00`;

function pet(id = 'pet-a', patch: Partial<Pet> = {}): Pet {
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
    reminder_class: 'routine', sort_order: 0,
    recurrence: { freq: 'once', date: today }, times_of_day: ['08:00'],
    starts_on: today, ends_on: null, pet_ids: ['pet-a', 'pet-b', 'pet-c', 'pet-d'],
    completion_mode: 'together', replaces_task_id: null, created_by: 'me',
    revision: 1, updated_at: stamp, deleted_at: null, ...patch,
  };
}

function completion(patch: Partial<Completion> = {}): Completion {
  return {
    id: 'completion', task_id: 'task', occurrence_key: `${today}T08:00`,
    pet_id: null, completed_by: 'other', completed_at: stamp,
    title_snapshot: 'Breakfast', photo_asset_id: null, note: null,
    undone_at: null, undone_by: null, revision: 1, updated_at: stamp, ...patch,
  };
}

function health(patch: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: 'health', pet_id: 'pet-a', type: 'vaccine', title: 'Booster', notes: null,
    occurred_at: stamp, next_due_on: '2026-10-17', attachment_asset_id: null,
    created_by: 'other', revision: 1, updated_at: stamp, deleted_at: null, ...patch,
  };
}

function timer(patch: Partial<Timer> = {}): Timer {
  return {
    id: 'timer', task_id: 'task', occurrence_key: `${today}T08:00`, pet_id: null,
    started_by: 'me', started_at: stamp, ends_at: '2026-10-07T10:05:00Z',
    cancelled_at: null, revision: 1, updated_at: stamp, ...patch,
  };
}

function input(patch: Partial<ReminderInput> = {}): ReminderInput {
  return {
    now, tz: 'America/Sao_Paulo', me: 'me', templates: [template()],
    completions: [], pets: ['pet-a', 'pet-b', 'pet-c', 'pet-d'].map((id) => pet(id)),
    healthEvents: [], timers: [], suppressedIds: new Set(), ...patch,
  };
}

function onlyItem(patch: Partial<ReminderInput> = {}): ReminderItem {
  const result = planReminders(input(patch));
  expect(result).toHaveLength(1);
  const item = result[0];
  if (item === undefined) throw new Error('Expected one reminder');
  return item;
}

describe('reminder planner', () => {
  it('RM-1 plans future timed occurrences from the replica without mutating inputs', () => {
    const source = input();
    const before = structuredClone(source);
    const result = planReminders(source);
    expect(result).toEqual([{
      id: reminderId, fireAt: slot, channel: 'reminders-routine', kind: 'reminder',
      taskId: 'task', occurrenceKey: `${today}T08:00`, taskTitle: 'Breakfast',
      petNames: ['pet-a', 'pet-b', 'pet-c', 'pet-d'], fp: expect.any(String),
    }]);
    expect(source).toEqual(before);
    for (const patch of [
      { deleted_at: stamp }, { ends_on: '2026-10-06' }, { starts_on: '2026-10-08' },
    ]) {
      expect(planReminders(input({ templates: [template(patch)] }))).toEqual([]);
    }
    expect(planReminders(input({ pets: [pet('pet-a', { archived_at: stamp })] }))).toEqual([]);
    expect(planReminders(input({ pets: [pet('pet-a', { deleted_at: stamp })] }))).toEqual([]);
  });

  it('RM-2 excludes another assignee and includes unassigned tasks', () => {
    expect(planReminders(input({ templates: [template({ assigned_to: 'other' })] }))).toEqual([]);
    expect(onlyItem({ templates: [template({ assigned_to: null })] }).id).toBe(reminderId);
  });

  it('RM-3 excludes all-day occurrences', () => {
    expect(planReminders(input({ templates: [template({ times_of_day: [] })] }))).toEqual([]);
  });

  it('RM-4 removes fully complete reminders and retains partial per-pet reminders', () => {
    expect(planReminders(input({ completions: [completion()] }))).toEqual([]);
    expect(onlyItem({ completions: [completion({ undone_at: stamp })] }).id).toBe(reminderId);
    for (const patch of [
      { task_id: 'other' }, { occurrence_key: `${today}T09:00` }, { pet_id: 'pet-a' },
    ]) {
      expect(onlyItem({ completions: [completion(patch)] }).id).toBe(reminderId);
    }
    const perPet = template({ completion_mode: 'per_pet' });
    const rows = ['pet-a', 'pet-b', 'pet-c', 'pet-d'].map((id) => completion({ id, pet_id: id }));
    expect(onlyItem({ templates: [perPet], completions: rows.slice(0, 2) }).id).toBe(reminderId);
    expect(planReminders(input({ templates: [perPet], completions: rows }))).toEqual([]);
    expect(onlyItem({
      templates: [perPet], completions: [rows[0], rows[0]].filter((row) => row !== undefined),
    }).id).toBe(reminderId);
    expect(onlyItem({
      templates: [perPet], completions: [completion({ pet_id: 'unlinked' })],
    }).id).toBe(reminderId);
    expect(planReminders(input({
      templates: [perPet], completions: rows.slice(0, 2),
      pets: [pet('pet-a'), pet('pet-b'), pet('pet-c', { archived_at: stamp })],
    }))).toEqual([]);
    expect(planReminders(input({
      templates: [template({ replaces_task_id: 'previous' })],
      completions: [completion({ task_id: 'previous' })],
    }))).toEqual([]);
  });

  it('RM-5 excludes past and current slots and uses the family calendar near UTC midnight', () => {
    expect(planReminders(input({ now: slot + 1 }))).toEqual([]);
    expect(planReminders(input({ now: slot }))).toEqual([]);
    expect(onlyItem({ now: slot - 1 }).fireAt).toBe(slot);
    expect(onlyItem({
      now: Date.parse('2026-10-08T01:00:00Z'),
      templates: [template({ times_of_day: ['23:00'] })],
    }).fireAt).toBe(Date.parse('2026-10-08T02:00:00Z'));
    // A skipped local date may resolve to a future instant on the next day.
    // Carry-over cards still cannot create reminders outside the date horizon.
    expect(planReminders(input({
      now: Date.parse('2011-12-30T21:00:00Z'), tz: 'Pacific/Apia',
      templates: [template({
        recurrence: { freq: 'once', date: '2011-12-30' },
        starts_on: '2011-12-30', times_of_day: ['23:00'],
      })],
    }))).toEqual([]);
  });

  it('RM-6 includes day plus seven and excludes day plus eight', () => {
    const templates = ['2026-10-14', '2026-10-15'].map((date) => template({
      id: date, recurrence: { freq: 'once', date }, starts_on: date,
    }));
    expect(planReminders(input({ templates })).map((item) => item.id))
      .toEqual(['rem:2026-10-14:2026-10-14T08:00']);
    expect(planReminders(input({
      templates: [template({ recurrence: { freq: 'daily', interval: 1 } })],
    }))).toHaveLength(8);
  });

  it('RM-7 caps task reminders at the 200 soonest without capping health dues or timers', () => {
    const templates = Array.from({ length: 250 }, (_, index) => {
      const time = `${String(8 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`;
      return template({ id: `task-${index}`, times_of_day: [time] });
    });
    const result = planReminders(input({
      templates: [...templates].reverse(), healthEvents: [health()],
      timers: [timer({ ends_at: '2026-10-07T20:00:00Z' })],
    }));
    expect(result).toHaveLength(202);
    expect(result.filter((item) => item.kind === 'reminder').map((item) => item.taskId))
      .toEqual(Array.from({ length: 200 }, (_, index) => `task-${index}`));
    expect(result.map((item) => item.fireAt)).toEqual(result.map((item) => item.fireAt).sort((a, b) => a - b));
    expect(result.slice(-2).map((item) => item.id)).toEqual(['tmr:timer', 'due:health']);
  });

  it('RM-8 plans health dues at local nine within thirty days and excludes stale events', () => {
    expect(onlyItem({ templates: [], healthEvents: [health()] })).toEqual({
      id: 'due:health', fireAt: Date.parse('2026-10-17T12:00:00Z'),
      channel: 'reminders-routine', kind: 'health_due', healthEventId: 'health',
      healthTitle: 'Booster', petName: 'pet-a', fp: expect.any(String),
    });
    const events = [
      health({ id: 'today', next_due_on: today }),
      health({ id: 'thirty', next_due_on: '2026-11-06' }),
      health({ id: 'past', next_due_on: '2026-10-06' }),
      health({ id: 'thirty-one', next_due_on: '2026-11-07' }),
      health({ id: 'deleted', deleted_at: stamp }), health({ id: 'no-due', next_due_on: null }),
    ];
    expect(planReminders(input({ templates: [], healthEvents: events })).map((item) => item.id))
      .toEqual(['due:today', 'due:thirty']);
    for (const instant of ['2026-10-07T12:00:00Z', '2026-10-07T12:00:00.001Z']) {
      expect(planReminders(input({
        now: Date.parse(instant), templates: [], healthEvents: [health({ next_due_on: today })],
      }))).toEqual([]);
    }
    expect(onlyItem({ templates: [], healthEvents: [health()], pets: [] })).not.toHaveProperty('petName');
    expect(onlyItem({
      templates: [], healthEvents: [health()], pets: [pet('pet-a', { archived_at: stamp })],
    }).petName).toBe('pet-a');
  });

  it('RM-9 plans only my running timers even without a task in the replica', () => {
    const timers = [timer(), timer({ id: 'other', started_by: 'other' }),
      timer({ id: 'cancelled', cancelled_at: stamp }), timer({ id: 'past', ends_at: '2026-10-07T09:59:59Z' }),
      timer({ id: 'current', ends_at: stamp })];
    const result = planReminders(input({ templates: [template({ assigned_to: 'other' })], timers }));
    expect(result).toEqual([{
      id: 'tmr:timer', fireAt: Date.parse('2026-10-07T10:05:00Z'), channel: 'timers', kind: 'timer',
      timerId: 'timer', taskId: 'task', occurrenceKey: `${today}T08:00`,
      taskTitle: 'Breakfast', fp: expect.any(String),
    }]);
    expect(onlyItem({ templates: [], timers: [timer()] })).not.toHaveProperty('taskTitle');
  });

  it('RM-10 fingerprints every output field stably and ignores unrelated replica metadata', () => {
    const original = onlyItem();
    expect(original.fp).toMatch(/^[0-9a-f]+$/);
    expect(onlyItem().fp).toBe(original.fp);
    expect(onlyItem({ templates: [template({ title: 'Dinner' })] }).fp).not.toBe(original.fp);
    expect(onlyItem({ pets: [pet('pet-a', { name: 'Renamed' })] }).fp).not.toBe(original.fp);
    expect(onlyItem({ tz: 'America/New_York' }).fp).not.toBe(original.fp);
    expect(onlyItem({ templates: [template({ reminder_class: 'critical' })] }).fp).not.toBe(original.fp);
    expect(onlyItem({ templates: [template({ revision: 2, updated_at: '2026-10-07T10:01:00Z' })] }).fp)
      .toBe(original.fp);
    const healthInput = { templates: [], healthEvents: [health()] };
    expect(onlyItem({ ...healthInput, healthEvents: [health({ title: 'New booster' })] }).fp)
      .not.toBe(onlyItem(healthInput).fp);
    expect(onlyItem({ ...healthInput, pets: [pet('pet-a', { name: 'Renamed' })] }).fp)
      .not.toBe(onlyItem(healthInput).fp);
    const timerInput = { templates: [template({ assigned_to: 'other' })], timers: [timer()] };
    expect(onlyItem({ ...timerInput, timers: [timer({ ends_at: '2026-10-07T10:06:00Z' })] }).fp)
      .not.toBe(onlyItem(timerInput).fp);
    expect(onlyItem({ ...timerInput, templates: [template({ assigned_to: 'other', title: 'Dinner' })] }).fp)
      .not.toBe(onlyItem(timerInput).fp);
    const tied = [template({ id: 'z' }), template({ id: 'a' })];
    expect(planReminders(input({ templates: tied }))).toEqual(planReminders(input({ templates: [...tied].reverse() })));
    expect(planReminders(input({ templates: tied })).map((item) => item.taskId)).toEqual(['a', 'z']);
  });

  it('RM-11 maps each reminder class to its Android channel', () => {
    expect(onlyItem({ templates: [template({ reminder_class: 'critical' })] }).channel)
      .toBe('reminders-critical');
    expect(onlyItem({ templates: [template({ reminder_class: 'routine' })] }).channel)
      .toBe('reminders-routine');
  });

  it('RM-12 excludes suppressed identifiers before choosing the soonest task reminders', () => {
    expect(planReminders(input({ suppressedIds: new Set([reminderId]) }))).toEqual([]);
    expect(onlyItem({ suppressedIds: new Set(['rem:other:2026-10-07T08:00']) }).id).toBe(reminderId);
    expect(planReminders(input({
      templates: [], healthEvents: [health()], timers: [timer()],
      suppressedIds: new Set(['due:health', 'tmr:timer']),
    }))).toEqual([]);
    const templates = Array.from({ length: 201 }, (_, index) => template({ id: `task-${index}` }));
    const result = planReminders(input({
      templates, suppressedIds: new Set([`rem:task-0:${today}T08:00`]),
    }));
    expect(result).toHaveLength(200);
    expect(result.some((item) => item.taskId === 'task-0')).toBe(false);
  });
});
