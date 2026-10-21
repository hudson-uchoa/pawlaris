import type * as Location from 'expo-location';
import type { SqlDriver } from '../db/driver';
import type { Kv } from '../db/kv';
import type { LocalWalk } from '../db/walkRepo';
import type { Clock } from '../platform/clock';
import type { Mutations } from '../sync/mutations';
import type { PointStore } from './pointStore';

export type TrackingLocationPort = Pick<typeof Location,
  | 'startLocationUpdatesAsync' | 'stopLocationUpdatesAsync'
  | 'watchPositionAsync' | 'getBackgroundPermissionsAsync'>;

export interface TrackerDependencies {
  driver: SqlDriver;
  kv: Kv;
  clock: Clock;
  points: PointStore;
  mutations: Pick<Mutations, 'startWalk'>;
  location: TrackingLocationPort;
  requestBackgroundLocation(): Promise<boolean>;
}

export interface WalkTracker {
  start(petId: string): Promise<LocalWalk>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}

export function createTracker(dependencies: TrackerDependencies): WalkTracker {
  void dependencies;
  return {
    async start(petId) {
      void petId;
      throw new Error('not implemented');
    },
    pause() { throw new Error('not implemented'); },
    resume() { throw new Error('not implemented'); },
    async stop() { throw new Error('not implemented'); },
  };
}
