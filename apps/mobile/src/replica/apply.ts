import type { SqlDriver } from '../db/driver';
import type { EntityRows, SyncEntity } from '../db/replicaRepo';
import type { ReplicaStore } from './store';

export interface Clock {
  now(): number;
}

export interface ReplicaDependencies {
  driver: SqlDriver;
  store: ReplicaStore;
  clock: Clock;
}

export type ServerChange = {
  [E in SyncEntity]: { entity: E; row: EntityRows[E] }
}[SyncEntity];

export interface ServerApplyOptions {
  cursor?: number;
  pullGen?: number;
}

export interface ReplicaApply {
  applyServerRows(changes: readonly ServerChange[], opts?: ServerApplyOptions): void;
  applyLocalRow<E extends SyncEntity>(entity: E, row: EntityRows[E]): void;
  removeRow(entity: SyncEntity, id: string): void;
}

export function createReplicaApply(dependencies: ReplicaDependencies): ReplicaApply {
  void dependencies;
  throw new Error('Replica apply not implemented');
}
