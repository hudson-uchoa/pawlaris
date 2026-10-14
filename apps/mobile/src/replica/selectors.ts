import {
  buildDayView,
  type Completion, type DayView, type DayViewInput, type Member, type Pet,
  type TaskTemplate, type Timer, type Walk,
} from '@pawlaris/shared';
import type { ReplicaState } from './store';

export type DayViewOptions = Pick<DayViewInput, 'date' | 'now' | 'me' | 'scope'>;

export interface TimerOptions {
  taskId: string;
  occurrenceKey: string;
  petId: string | null;
  now: number;
}

export function selectPets(state: ReplicaState): Pet[] {
  return Object.values(state.pets);
}

export function selectPet(state: ReplicaState, id: string): Pet | null {
  return state.pets[id] ?? null;
}

export function selectMembers(state: ReplicaState): Member[] {
  return Object.values(state.members);
}

export function selectMe(state: ReplicaState, userId: string): Member | null {
  return state.members[userId] ?? null;
}

export function selectTemplates(state: ReplicaState): TaskTemplate[] {
  return Object.values(state.taskTemplates);
}

export function selectCompletionsForRange(
  state: ReplicaState, from: string, to: string,
): Completion[] {
  return Object.values(state.completions).filter((row) => row.occurrence_key >= from && row.occurrence_key <= to);
}

export function selectTimerFor(state: ReplicaState, options: TimerOptions): Timer | null {
  let latest: Timer | null = null;
  for (const timer of Object.values(state.timers)) {
    if (timer.task_id !== options.taskId || timer.occurrence_key !== options.occurrenceKey
      || timer.pet_id !== options.petId || timer.cancelled_at !== null
      || Date.parse(timer.ends_at) <= options.now - 60_000) continue;
    if (latest === null || Date.parse(timer.ends_at) > Date.parse(latest.ends_at)) latest = timer;
  }
  return latest;
}

export function selectWalks(state: ReplicaState): Walk[] {
  return Object.values(state.walks);
}

export function selectDayView(state: ReplicaState, options: DayViewOptions): DayView {
  if (state.family === null) return { overdue: [], now: [], later: [], done: [], allDone: false };
  return buildDayView({
    ...options, tz: state.family.timezone, pets: Object.values(state.pets),
    templates: Object.values(state.taskTemplates), completions: Object.values(state.completions),
    pendingCompletionIds: new Set(Object.keys(state.completions)
      .filter((id) => state.pending[`task_completions:${id}`] === true)),
  });
}
