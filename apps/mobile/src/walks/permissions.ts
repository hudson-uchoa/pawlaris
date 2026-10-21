import type { Kv } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { LocationPort, WalkPermissionsPort } from './port';

export type LocationState = 'granted' | 'approximate' | 'denied' | 'blocked';
export type TrackingMode = 'service' | 'foreground';
export type LocationPermissionStep = 'location' | 'notifications' | 'battery' | 'backgroundLocation';

export interface WalkPermissionStates {
  location: LocationState;
  backgroundLocation: 'granted' | 'denied' | 'blocked';
  batteryOptimizationEnabled: boolean;
  camera: 'granted' | 'denied' | 'blocked';
}

export interface LocationPermissions {
  readLocationState(): Promise<LocationState>;
  readLadder(): Promise<readonly LocationPermissionStep[]>;
  requestLocation(): Promise<LocationState>;
  requestNotifications(): Promise<boolean>;
  openLocationSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  openBackgroundSettings(): Promise<void>;
  readRows(): Promise<WalkPermissionStates>;
  requestCamera(): Promise<boolean>;
  openCameraSettings(): Promise<void>;
  start(): Promise<void>;
  subscribe(listener: (state: LocationState) => void): () => void;
  dispose(): void;
}

export interface LocationPermissionDependencies {
  kv: Pick<Kv, 'get' | 'set'>;
  clock: Clock;
  platform: WalkPermissionsPort;
}

export async function readLocationState(
  _platform: Pick<LocationPort, 'getForegroundPermissionsAsync'>,
): Promise<LocationState> {
  throw new Error('not implemented');
}

export function createLocationPermissions(_deps: LocationPermissionDependencies): LocationPermissions {
  return {
    async readLocationState() { throw new Error('not implemented'); },
    async readLadder() { throw new Error('not implemented'); },
    async requestLocation() { throw new Error('not implemented'); },
    async requestNotifications() { throw new Error('not implemented'); },
    async openLocationSettings() { throw new Error('not implemented'); },
    async openBatterySettings() { throw new Error('not implemented'); },
    async openBackgroundSettings() { throw new Error('not implemented'); },
    async readRows() { throw new Error('not implemented'); },
    async requestCamera() { throw new Error('not implemented'); },
    async openCameraSettings() { throw new Error('not implemented'); },
    async start() { throw new Error('not implemented'); },
    subscribe(_listener) { throw new Error('not implemented'); },
    dispose() { throw new Error('not implemented'); },
  };
}
