import { localDate, type Completion, type HealthEvent, type Member, type TaskTemplate } from '@pawlaris/shared';
import type { ReplicaState } from '../../replica/store';

export type PetHealthTimelineEntry =
  | { kind: 'event'; event: HealthEvent }
  | { kind: 'care'; completion: Completion; task: TaskTemplate; member: Member | null };

export type PetHealthTimelineMonth = {
  month: string;
  entries: readonly PetHealthTimelineEntry[];
};

export function selectPetHealthTimeline(
  state: ReplicaState, petId: string,
): readonly PetHealthTimelineMonth[] {
  if (state.family === null) return [];
  const entries: PetHealthTimelineEntry[] = Object.values(state.healthEvents)
    .filter((event) => event.pet_id === petId && event.deleted_at === null)
    .map((event) => ({ kind: 'event', event }));
  for (const completion of Object.values(state.completions)) {
    if (completion.undone_at !== null) continue;
    const task = state.taskTemplates[completion.task_id];
    if (task === undefined || (task.category !== 'vet' && task.category !== 'medication')
      || !task.pet_ids.includes(petId)) continue;
    if (completion.pet_id !== (task.completion_mode === 'together' ? null : petId)) continue;
    entries.push({ kind: 'care', completion, task, member: state.members[completion.completed_by] ?? null });
  }
  entries.sort((a, b) => entryTime(b) - entryTime(a)
    || (a.kind === 'event' ? a.event.id : a.completion.id)
      .localeCompare(b.kind === 'event' ? b.event.id : b.completion.id));
  const months = new Map<string, PetHealthTimelineEntry[]>();
  for (const entry of entries) {
    const month = localDate(entryTime(entry), state.family.timezone).slice(0, 7);
    const group = months.get(month);
    if (group === undefined) months.set(month, [entry]);
    else group.push(entry);
  }
  return [...months].sort(([a], [b]) => b.localeCompare(a))
    .map(([month, entries]) => ({ month, entries }));
}

function entryTime(entry: PetHealthTimelineEntry): number {
  return Date.parse(entry.kind === 'event' ? entry.event.occurred_at : entry.completion.completed_at);
}
