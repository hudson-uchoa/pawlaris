import type { Completion, HealthEvent, Member, TaskTemplate } from '@pawlaris/shared';
import type { ReplicaState } from '../../replica/store';

export type PetHealthTimelineEntry =
  | { kind: 'event'; event: HealthEvent }
  | { kind: 'care'; completion: Completion; task: TaskTemplate; member: Member | null };

export type PetHealthTimelineMonth = {
  month: string;
  entries: readonly PetHealthTimelineEntry[];
};

export function selectPetHealthTimeline(
  _state: ReplicaState, _petId: string,
): readonly PetHealthTimelineMonth[] {
  throw new Error('not implemented');
}
