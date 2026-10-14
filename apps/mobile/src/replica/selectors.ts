import type {
  Completion, DayView, DayViewInput, Member, Pet, TaskTemplate, Timer, Walk,
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
  void state;
  throw new Error('Replica selectPets not implemented');
}

export function selectPet(state: ReplicaState, id: string): Pet | null {
  void state; void id;
  throw new Error('Replica selectPet not implemented');
}

export function selectMembers(state: ReplicaState): Member[] {
  void state;
  throw new Error('Replica selectMembers not implemented');
}

export function selectMe(state: ReplicaState, userId: string): Member | null {
  void state; void userId;
  throw new Error('Replica selectMe not implemented');
}

export function selectTemplates(state: ReplicaState): TaskTemplate[] {
  void state;
  throw new Error('Replica selectTemplates not implemented');
}

export function selectCompletionsForRange(
  state: ReplicaState, from: string, to: string,
): Completion[] {
  void state; void from; void to;
  throw new Error('Replica selectCompletionsForRange not implemented');
}

export function selectTimerFor(state: ReplicaState, options: TimerOptions): Timer | null {
  void state; void options;
  throw new Error('Replica selectTimerFor not implemented');
}

export function selectWalks(state: ReplicaState): Walk[] {
  void state;
  throw new Error('Replica selectWalks not implemented');
}

export function selectDayView(state: ReplicaState, options: DayViewOptions): DayView {
  void state; void options;
  throw new Error('Replica selectDayView not implemented');
}
