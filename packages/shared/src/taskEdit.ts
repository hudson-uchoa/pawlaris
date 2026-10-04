import { addDays, compareDateKey, type DateKey } from './dates';
import type { Completion, TaskTemplate } from './entities';
import { occurrences } from './recurrence';

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

// Q-9: compare validated field values structurally, preserving array order.
function scheduleValueKey(value: TaskTemplate[typeof SCHEDULE_FIELDS[number]]): string {
  return typeof value === 'object' && !Array.isArray(value)
    ? JSON.stringify(value, Object.keys(value).sort()) : JSON.stringify(value);
}

export function classifyTaskEdit(old: TaskTemplate, edited: TaskEdits): 'cosmetic' | 'schedule' {
  return SCHEDULE_FIELDS.some((field) => {
    const value = edited[field];
    return value !== undefined && scheduleValueKey(value) !== scheduleValueKey(old[field]);
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
    // Q-9: FK-7's once date takes precedence over E for the successor only.
    starts_on: merged.recurrence.freq === 'once' ? merged.recurrence.date : E,
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
