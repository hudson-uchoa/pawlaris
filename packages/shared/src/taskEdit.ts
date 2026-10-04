import {
  addDays, compareDateKey, daysBetween, formatDateKey, mondayOf, monthsBetween,
  parseDateKey, type DateKey,
} from './dates';
import type { Completion, TaskTemplate } from './entities';
import { occurrences, type Recurrence } from './recurrence';

export const SCHEDULE_FIELDS = [
  'recurrence', 'times_of_day', 'starts_on', 'pet_ids', 'completion_mode',
] as const satisfies readonly (keyof TaskTemplate)[];

export const COSMETIC_FIELDS = [
  'title', 'description', 'category', 'assigned_to', 'requires_photo',
  'timer_seconds', 'reminder_class', 'sort_order',
] as const satisfies readonly (keyof TaskTemplate)[];

type EditableField = typeof SCHEDULE_FIELDS[number] | typeof COSMETIC_FIELDS[number];
export type TaskEdits = Partial<Pick<TaskTemplate, EditableField>>;
export type ForkTemplate = Pick<TaskTemplate,
  EditableField | 'id' | 'ends_on' | 'replaces_task_id'>;
export type EndPatch = { ends_on: DateKey };
export type ForkResult = { newTemplate: ForkTemplate; oldPatch: EndPatch };
export type ForkEffectiveDateInput = {
  template: TaskTemplate;
  completions: readonly Completion[];
  today: DateKey;
};

// Q-9: pets and selected days are sets; validated times stay ordered.
function scheduleValueKey(
  field: typeof SCHEDULE_FIELDS[number],
  value: TaskTemplate[typeof SCHEDULE_FIELDS[number]],
): string {
  if (typeof value === 'object' && !Array.isArray(value)) {
    const rule = value.freq === 'weekly' ? { ...value, byday: [...value.byday].sort() }
      : value.freq === 'monthly'
        ? { ...value, bymonthday: [...value.bymonthday].sort((a, b) => a - b) } : value;
    return JSON.stringify(rule, Object.keys(rule).sort());
  }
  return JSON.stringify(field === 'pet_ids' && Array.isArray(value) ? [...value].sort() : value);
}

export function classifyTaskEdit(old: TaskTemplate, edited: TaskEdits): 'cosmetic' | 'schedule' {
  return SCHEDULE_FIELDS.some((field) => {
    const value = edited[field];
    return value !== undefined
      && scheduleValueKey(field, value) !== scheduleValueKey(field, old[field]);
  }) ? 'schedule' : 'cosmetic';
}

export function forkEffectiveDate({ template, completions, today }: ForkEffectiveDateInput): DateKey {
  const keys = new Set(occurrences({
    recurrence: template.recurrence, timesOfDay: template.times_of_day,
    startsOn: template.starts_on, endsOn: template.ends_on, from: today, to: today,
  }));
  const hasLiveCompletion = completions.some((row) => row.task_id === template.id
    && row.undone_at === null && keys.has(row.occurrence_key));
  const E = hasLiveCompletion ? addDays(today, 1) : today;
  return compareDateKey(E, template.starts_on) < 0 ? template.starts_on : E;
}

// ADR-034: retain the old cycle unless the frequency or interval changes.
function successorStart(old: TaskTemplate, rule: Recurrence, E: DateKey): DateKey {
  if (rule.freq === 'once') return rule.date;
  const previous = old.recurrence;
  if (previous.freq === 'once' || rule.freq !== previous.freq
    || rule.interval !== previous.interval) return E;
  switch (rule.freq) {
    case 'daily': {
      const r = daysBetween(old.starts_on, E) % rule.interval;
      return r === 0 ? E : addDays(E, rule.interval - r);
    }
    case 'weekly': {
      const monday = mondayOf(E);
      const r = (daysBetween(mondayOf(old.starts_on), monday) / 7) % rule.interval;
      return r === 0 ? E : addDays(monday, 7 * (rule.interval - r));
    }
    case 'monthly': {
      const r = monthsBetween(old.starts_on, E) % rule.interval;
      if (r === 0) return E;
      const { y, m } = parseDateKey(E);
      const month = m - 1 + rule.interval - r;
      return formatDateKey({ y: y + Math.floor(month / 12), m: month % 12 + 1, d: 1 });
    }
  }
}

export function buildFork(
  old: TaskTemplate, edited: TaskEdits, E: DateKey, newId: string,
): ForkResult {
  const merged = { ...old, ...edited };
  // Q-9: return the create payload; the mutation layer fills replica metadata.
  const newTemplate: ForkTemplate = {
    id: newId,
    title: merged.title,
    description: merged.description,
    category: merged.category,
    assigned_to: merged.assigned_to,
    requires_photo: merged.requires_photo,
    timer_seconds: merged.timer_seconds,
    reminder_class: merged.reminder_class,
    sort_order: merged.sort_order,
    recurrence: merged.recurrence,
    times_of_day: merged.times_of_day,
    starts_on: successorStart(old, merged.recurrence, E),
    pet_ids: merged.pet_ids,
    completion_mode: merged.completion_mode,
    ends_on: old.ends_on,
    replaces_task_id: old.id,
  };
  return { newTemplate, oldPatch: buildEnd(old, E) };
}

export function buildEnd(_old: TaskTemplate, E: DateKey): EndPatch {
  void _old;
  return { ends_on: addDays(E, -1) };
}
