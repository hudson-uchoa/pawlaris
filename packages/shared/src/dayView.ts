import { addDays, type DateKey } from './dates';
import type { Completion, Pet, TaskTemplate } from './entities';
import { occurrences, splitKey } from './recurrence';
import { localDate, slotInstant } from './time';

export type DayViewInput = {
  date: DateKey;
  now: number;
  tz: string;
  me: string;
  scope: 'mine' | 'all' | `user:${string}`;
  templates: readonly TaskTemplate[];
  completions: readonly Completion[];
  pets: readonly Pet[];
  pendingCompletionIds: ReadonlySet<string>;
};

export type DayViewItem = {
  taskId: string;
  occurrenceKey: string;
  slotMs: number | null;
  originalDate: DateKey;
  mode: TaskTemplate['completion_mode'];
  pets: Pet[];
  progress: { done: number; total: number };
  completions: Completion[];
  assignedTo: string | null;
  title: string;
  orphan: boolean;
};

export type DayView = {
  overdue: DayViewItem[];
  now: DayViewItem[];
  later: DayViewItem[];
  done: DayViewItem[];
  allDone: boolean;
};

function inScope(template: TaskTemplate, input: DayViewInput): boolean {
  return input.scope === 'all' || (input.scope === 'mine'
    ? template.assigned_to === input.me || template.assigned_to === null
    : template.assigned_to === input.scope.slice(5));
}

function preferCompletion(
  rows: Map<string | null, Completion>, row: Completion, pending: ReadonlySet<string>,
): void {
  const previous = rows.get(row.pet_id);
  if (previous === undefined || (pending.has(previous.id) && !pending.has(row.id))) {
    rows.set(row.pet_id, row);
  }
}

// Q-8: together has one required completion; per_pet counts active pets.
function completionProgress(
  mode: TaskTemplate['completion_mode'], pets: readonly Pet[], rows: readonly Completion[],
): DayViewItem['progress'] {
  return { done: rows.length, total: mode === 'together' ? 1 : pets.length };
}

// Q-8: all-day slots sort first. Neither comparison uses the host locale.
function compareItems(a: DayViewItem, b: DayViewItem, templates: ReadonlyMap<string, TaskTemplate>): number {
  const aSlot = a.slotMs ?? -Infinity;
  const bSlot = b.slotMs ?? -Infinity;
  if (aSlot < bSlot) return -1;
  if (aSlot > bSlot) return 1;
  const order = (templates.get(a.taskId)?.sort_order ?? 0) - (templates.get(b.taskId)?.sort_order ?? 0);
  if (order !== 0) return order;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

function keysBetween(template: TaskTemplate, from: DateKey, to: DateKey): string[] {
  return occurrences({
    recurrence: template.recurrence, timesOfDay: template.times_of_day,
    startsOn: template.starts_on, endsOn: template.ends_on, from, to,
  });
}

function makeItem(
  template: TaskTemplate, key: string, pets: Pet[], rows: Completion[], tz: string, orphan: boolean,
): DayViewItem {
  const { date, time } = splitKey(key);
  return {
    taskId: template.id, occurrenceKey: key,
    slotMs: time === null ? null : slotInstant(date, time, tz), originalDate: date,
    mode: template.completion_mode, pets, progress: completionProgress(template.completion_mode, pets, rows),
    completions: rows, assignedTo: template.assigned_to, title: template.title, orphan,
  };
}

export function buildDayView(input: DayViewInput): DayView {
  const today = localDate(input.now, input.tz);
  const templates = new Map(input.templates.map((template) => [template.id, template]));
  const petsById = new Map(input.pets.map((pet) => [pet.id, pet]));
  const live = new Map<string, Map<string, Map<string | null, Completion>>>();
  for (const row of input.completions) {
    if (row.undone_at !== null) continue;
    let task = live.get(row.task_id);
    if (task === undefined) {
      task = new Map();
      live.set(row.task_id, task);
    }
    let occurrence = task.get(row.occurrence_key);
    if (occurrence === undefined) {
      occurrence = new Map();
      task.set(row.occurrence_key, occurrence);
    }
    preferCompletion(occurrence, row, input.pendingCompletionIds);
  }

  const view: DayView = { overdue: [], now: [], later: [], done: [], allDone: false };
  const consumed = new Set<string>();
  for (const template of input.templates) {
    if (template.deleted_at !== null) continue;
    const pets = template.pet_ids.flatMap((id) => {
      const pet = petsById.get(id);
      return pet !== undefined && pet.archived_at === null && pet.deleted_at === null ? [pet] : [];
    });
    if (pets.length === 0) continue;
    let keys = keysBetween(template, input.date, input.date);
    const carrying = keys.length === 0 && input.date === today && template.recurrence.freq !== 'daily';
    if (carrying) {
      const past = keysBetween(template, addDays(today, -30), addDays(today, -1));
      const latest = past.at(-1);
      if (latest !== undefined) {
        const latestDate = splitKey(latest).date;
        keys = past.filter((key) => splitKey(key).date === latestDate);
      }
    }
    for (const key of keys) {
      const own = live.get(template.id)?.get(key);
      const predecessor = template.replaces_task_id === null
        ? undefined : live.get(template.replaces_task_id)?.get(key);
      const matches = new Map<string | null, Completion>();
      for (const row of [...(own?.values() ?? []), ...(predecessor?.values() ?? [])]) {
        const validPet = template.completion_mode === 'together'
          ? row.pet_id === null : pets.some((pet) => pet.id === row.pet_id);
        if (validPet) {
          consumed.add(row.id);
          preferCompletion(matches, row, input.pendingCompletionIds);
        } else if (row.task_id === template.id) {
          // Archiving a pet removes its toggle, without inventing a second card.
          consumed.add(row.id);
        }
      }
      const item = makeItem(template, key, pets, [...matches.values()], input.tz, false);
      const complete = item.progress.done === item.progress.total;
      if (!inScope(template, input) || (carrying && complete)) continue;
      if (complete) view.done.push(item);
      else if (carrying || input.date < today) view.overdue.push(item);
      else if (input.date > today) view.later.push(item);
      else if (item.slotMs === null) view.now.push(item);
      else if (item.slotMs + 60 * 60_000 < input.now) view.overdue.push(item);
      else if (input.now < item.slotMs - 60 * 60_000) view.later.push(item);
      else view.now.push(item);
    }
  }

  for (const [taskId, occurrences] of live) {
    const template = templates.get(taskId);
    if (template === undefined || !inScope(template, input)) continue;
    for (const [key, rows] of occurrences) {
      if (splitKey(key).date !== input.date) continue;
      const orphanRows = [...rows.values()].filter((row) => !consumed.has(row.id));
      const first = orphanRows[0];
      if (first === undefined) continue;
      const petIds = template.completion_mode === 'together'
        ? template.pet_ids : orphanRows.flatMap((row) => row.pet_id === null ? [] : [row.pet_id]);
      const pets = petIds.flatMap((id) => {
        const pet = petsById.get(id);
        return pet === undefined ? [] : [pet];
      });
      const item = makeItem(template, key, pets, orphanRows, input.tz, true);
      item.title = first.title_snapshot;
      view.done.push(item);
    }
  }
  for (const group of [view.overdue, view.now, view.later, view.done]) {
    group.sort((a, b) => compareItems(a, b, templates));
  }
  view.allDone = view.done.length > 0 && view.overdue.length + view.now.length + view.later.length === 0;
  return view;
}
