import type { DateKey } from './dates';
import type { Completion, Pet, TaskTemplate } from './entities';

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

export function buildDayView(input: DayViewInput): DayView {
  void input;
  throw new Error('not implemented');
}
