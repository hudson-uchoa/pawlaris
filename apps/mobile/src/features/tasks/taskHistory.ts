import { occurrences, type Completion, type TaskTemplate } from '@pawlaris/shared';

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

export function buildTaskHistory({ task, from, to, completions }: TaskHistoryInput): TaskHistoryRow[] {
  const live = new Map<string, Map<string | null, Completion>>();
  for (const completion of completions) {
    if (completion.task_id !== task.id || completion.undone_at !== null || completion.duplicate_of !== null) continue;
    let slot = live.get(completion.occurrence_key);
    if (slot === undefined) {
      slot = new Map();
      live.set(completion.occurrence_key, slot);
    }
    slot.set(completion.pet_id, completion);
  }
  const petIds = task.completion_mode === 'together' ? [null] : task.pet_ids;
  return occurrences({ recurrence: task.recurrence, timesOfDay: task.times_of_day,
    startsOn: task.starts_on, endsOn: task.ends_on, from, to,
  }).sort().reverse().flatMap((occurrenceKey) => petIds.map((petId) => ({
    occurrenceKey, petId, completion: live.get(occurrenceKey)?.get(petId) ?? null,
  })));
}
