import type { DateKey } from './dates';
import type { Completion, TaskTemplate } from './entities';

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

export function classifyTaskEdit(_old: TaskTemplate, _edited: TaskEdits): 'cosmetic' | 'schedule' {
  void _old;
  void _edited;
  throw new Error('not implemented');
}

export function forkEffectiveDate(_input: ForkEffectiveDateInput): DateKey {
  void _input;
  throw new Error('not implemented');
}

export function buildFork(
  _old: TaskTemplate, _edited: TaskEdits, _E: DateKey, _newId: string,
): ForkResult {
  void _old;
  void _edited;
  void _E;
  void _newId;
  throw new Error('not implemented');
}

export function buildEnd(_old: TaskTemplate, _E: DateKey): EndPatch {
  void _old;
  void _E;
  throw new Error('not implemented');
}
