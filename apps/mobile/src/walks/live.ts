import type { SqlDriver } from '../db/driver';
import type { LocalWalk } from '../db/walkRepo';
import type { Clock } from '../platform/clock';
import type { Mutations } from '../sync/mutations';
import type { PointStore } from './pointStore';
import type { WalkTracker } from './tracker';

export interface LocalWalkActionDependencies {
  driver: SqlDriver;
  clock: Clock;
  points: PointStore;
  tracker: WalkTracker;
  mutations: Pick<Mutations, 'finishWalk' | 'discardWalk'>;
}

export interface LiveWalkServices {
  clock: Clock;
  points: PointStore;
  tracker: WalkTracker;
  readLocalWalk(): LocalWalk | null;
  finish(): Promise<string>;
  discard(): Promise<void>;
}

export function finishLocalWalk(dependencies: LocalWalkActionDependencies): Promise<string> {
  void dependencies;
  throw new Error('not implemented');
}

export function discardLocalWalk(dependencies: LocalWalkActionDependencies): Promise<void> {
  void dependencies;
  throw new Error('not implemented');
}
