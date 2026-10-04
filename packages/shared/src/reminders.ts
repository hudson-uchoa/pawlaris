import type { Completion, HealthEvent, Pet, TaskTemplate, Timer } from './entities';

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

export function planReminders(input: ReminderInput): ReminderItem[] {
  void input;
  throw new Error('not implemented');
}
