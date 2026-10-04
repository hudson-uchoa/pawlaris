import { addDays } from './dates';
import { buildDayView } from './dayView';
import type { Completion, HealthEvent, Pet, TaskTemplate, Timer } from './entities';
import { localDate, slotInstant } from './time';

export type ReminderInput = {
  now: number;
  tz: string;
  me: string;
  templates: readonly TaskTemplate[];
  completions: readonly Completion[];
  pets: readonly Pet[];
  healthEvents: readonly HealthEvent[];
  timers: readonly Timer[];
  suppressedIds: ReadonlySet<string>;
};

// Q-10: kind values and the health channel are planner-owned metadata.
export type ReminderItem = {
  id: string;
  fireAt: number;
  channel: 'reminders-critical' | 'reminders-routine' | 'timers';
  kind: 'reminder' | 'health_due' | 'timer';
  taskId?: string;
  occurrenceKey?: string;
  taskTitle?: string;
  petNames?: string[];
  healthEventId?: string;
  healthTitle?: string;
  petName?: string;
  timerId?: string;
  fp: string;
};

type UnfingerprintedItem = Omit<ReminderItem, 'fp'>;

function fingerprint(item: UnfingerprintedItem): string {
  const text = JSON.stringify(item, Object.keys(item).sort());
  // FNV-1a over JavaScript string code units; no host encoding or locale.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compareReminders(a: ReminderItem, b: ReminderItem): number {
  return a.fireAt - b.fireAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function planReminders(input: ReminderInput): ReminderItem[] {
  const today = localDate(input.now, input.tz);
  const templates = new Map(input.templates.map((row) => [row.id, row]));
  const pets = new Map(input.pets.map((row) => [row.id, row]));
  const tasks: ReminderItem[] = [];
  const append = (items: ReminderItem[], item: UnfingerprintedItem): void => {
    if (item.fireAt > input.now && !input.suppressedIds.has(item.id)) {
      items.push({ ...item, fp: fingerprint(item) });
    }
  };

  for (let day = 0; day <= 7; day += 1) {
    const date = addDays(today, day);
    const view = buildDayView({
      date, now: input.now, tz: input.tz, me: input.me,
      scope: 'mine', templates: input.templates, completions: input.completions,
      pets: input.pets, pendingCompletionIds: new Set(),
    });
    for (const item of [...view.overdue, ...view.now, ...view.later]) {
      if (item.originalDate !== date || item.slotMs === null) continue;
      append(tasks, {
        id: `rem:${item.taskId}:${item.occurrenceKey}`, fireAt: item.slotMs,
        channel: templates.get(item.taskId)?.reminder_class === 'critical'
          ? 'reminders-critical' : 'reminders-routine',
        kind: 'reminder', taskId: item.taskId, occurrenceKey: item.occurrenceKey,
        taskTitle: item.title, petNames: item.pets.map((pet) => pet.name),
      });
    }
  }

  // Q-10: the task cap excludes health dues and timers; ties sort by id.
  const planned = tasks.sort(compareReminders).slice(0, 200);
  const healthHorizon = addDays(today, 30);
  for (const event of input.healthEvents) {
    const due = event.next_due_on;
    if (event.deleted_at !== null || due === null || due < today || due > healthHorizon) continue;
    const pet = pets.get(event.pet_id);
    if (pet === undefined || pet.archived_at !== null || pet.deleted_at !== null) continue;
    append(planned, {
      id: `due:${event.id}`, fireAt: slotInstant(due, '09:00', input.tz),
      channel: 'reminders-routine', kind: 'health_due',
      healthEventId: event.id, healthTitle: event.title,
      petName: pet.name,
    });
  }
  for (const timer of input.timers) {
    if (timer.cancelled_at !== null || timer.started_by !== input.me) continue;
    const template = templates.get(timer.task_id);
    append(planned, {
      id: `tmr:${timer.id}`, fireAt: Date.parse(timer.ends_at), channel: 'timers', kind: 'timer',
      timerId: timer.id, taskId: timer.task_id, occurrenceKey: timer.occurrence_key,
      ...(template === undefined ? {} : { taskTitle: template.title }),
    });
  }
  return planned.sort(compareReminders);
}
