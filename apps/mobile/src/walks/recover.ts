import type { LocalWalk } from '../db/walkRepo';
import type { LocalWalkActionDependencies } from './live';
import type { TrackingLocationPort } from './tracker';

export interface RecoverableWalk {
  walk: LocalWalk;
  distanceM: number;
}

export interface WalkRecoveryDependencies extends LocalWalkActionDependencies {
  location: TrackingLocationPort & Pick<typeof import('expo-location'), 'hasStartedLocationUpdatesAsync'>;
}

export interface WalkRecovery {
  getSnapshot(): RecoverableWalk | null;
  subscribe(listener: () => void): () => void;
  recoverIfNeeded(): Promise<void>;
  continue(): Promise<void>;
  finish(): Promise<string>;
  dispose(): void;
}

export function createWalkRecovery(_dependencies: WalkRecoveryDependencies): WalkRecovery {
  throw new Error('not implemented');
}
