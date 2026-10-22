import type { SqlDriver } from '../db/driver';
import type { Clock } from '../platform/clock';
import type { ReplicaStore } from '../replica/store';
import type { Mutations } from '../sync/mutations';

export interface PerfSeedDependencies {
  driver: SqlDriver;
  clock: Clock;
  store: ReplicaStore;
  mutations: Mutations;
}

export function seedPerformance(_deps: PerfSeedDependencies): void {
  throw new Error('not implemented');
}
