import type {
  Asset, Completion, Family, HealthEvent, Member, Pet, TaskTemplate,
  Timer, Walk, WeightEntry,
} from '@pawlaris/shared';
import type { SqlDriver } from './driver';

export interface EntityRows {
  members: Member;
  family: Family;
  pets: Pet;
  task_templates: TaskTemplate;
  weight_entries: WeightEntry;
  health_events: HealthEvent;
  task_completions: Completion;
  task_timers: Timer;
  walk_sessions: Walk;
  assets: Asset;
}
export type SyncEntity = keyof EntityRows;
export interface ReplicaMetadata {
  pending: boolean;
  deleted: boolean;
  pullGen: number;
}
export interface ReplicaRecord<E extends SyncEntity = SyncEntity> extends ReplicaMetadata {
  entity: E;
  id: string;
  revision: number | null;
  sortKey: string | null;
  row: EntityRows[E];
}
export interface ReseedCursor {
  entity: SyncEntity;
  id: string;
}

export class ReplicaRepo {
  constructor(private readonly driver: SqlDriver) {}

  get<E extends SyncEntity>(_entity: E, _id: string): ReplicaRecord<E> | null {
    throw new Error('not implemented: ReplicaRepo.get');
  }
  upsert<E extends SyncEntity>(_entity: E, _row: EntityRows[E], _metadata: ReplicaMetadata): void {
    throw new Error('not implemented: ReplicaRepo.upsert');
  }
  remove(_entity: SyncEntity, _id: string): void {
    throw new Error('not implemented: ReplicaRepo.remove');
  }
  allExceptOldCompletions(_cutoff: string): ReplicaRecord[] {
    throw new Error('not implemented: ReplicaRepo.allExceptOldCompletions');
  }
  range<E extends SyncEntity>(_entity: E, _from: string, _to: string): ReplicaRecord<E>[] {
    throw new Error('not implemented: ReplicaRepo.range');
  }
  clearSynced(): void {
    throw new Error('not implemented: ReplicaRepo.clearSynced');
  }
  sweepUnmarked(_pullGen: number): void {
    throw new Error('not implemented: ReplicaRepo.sweepUnmarked');
  }
  pageForReseed(_after: ReseedCursor | null, _limit: number): ReplicaRecord[] {
    throw new Error('not implemented: ReplicaRepo.pageForReseed');
  }
}
