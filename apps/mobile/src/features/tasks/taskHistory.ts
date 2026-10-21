import type { Completion, TaskTemplate } from '@pawlaris/shared';

export interface TaskHistoryRow {
  occurrenceKey: string;
  petId: string | null;
  completion: Completion | null;
}

export interface TaskHistoryInput {
  task: TaskTemplate;
  from: string;
  to: string;
  completions: readonly Completion[];
}

export function buildTaskHistory(_input: TaskHistoryInput): TaskHistoryRow[] {
  throw new Error('not implemented');
}
