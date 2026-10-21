import type { Kv } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { PermissionResponse } from 'expo';
import { ActivityAction } from 'expo-intent-launcher';
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
  readonly manufacturer: string | null;
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
  platform: Pick<LocationPort, 'getForegroundPermissionsAsync'>,
): Promise<LocationState> {
  return locationState(await platform.getForegroundPermissionsAsync());
}

function permissionState(response: PermissionResponse): 'granted' | 'denied' | 'blocked' {
  return response.granted ? 'granted' : response.canAskAgain ? 'denied' : 'blocked';
}

function locationState(response: Awaited<ReturnType<LocationPort['getForegroundPermissionsAsync']>>): LocationState {
  if (response.granted && response.android?.accuracy !== 'fine') return 'approximate';
  return permissionState(response);
}

export function createLocationPermissions({ kv, platform }: LocationPermissionDependencies): LocationPermissions {
  const listeners = new Set<(state: LocationState) => void>();
  let subscription: ReturnType<WalkPermissionsPort['appState']['addEventListener']> | undefined;
  let disposed = false;
  const publish = (state: LocationState): LocationState => {
    if (!disposed) for (const listener of listeners) listener(state);
    return state;
  };
  return {
    manufacturer: platform.manufacturer,
    readLocationState: () => readLocationState(platform.location),
    async readLadder() {
      const steps: LocationPermissionStep[] = [];
      if (await readLocationState(platform.location) !== 'granted') steps.push('location');
      if (platform.androidVersion >= 33 && kv.get('notifications_prompt_done') !== '1'
        && !(await platform.notifications.getPermissionsAsync()).granted) {
        steps.push('notifications');
      }
      if (kv.get('battery_prompt_done') !== '1') steps.push('battery');
      if (kv.get('needs_background_location') === '1'
        && !(await platform.location.getBackgroundPermissionsAsync()).granted) steps.push('backgroundLocation');
      return steps;
    },
    async requestLocation() {
      return publish(locationState(await platform.location.requestForegroundPermissionsAsync()));
    },
    async requestNotifications() {
      const response = await platform.notifications.requestPermissionsAsync();
      kv.set('notifications_prompt_done', '1');
      return response.granted;
    },
    async openLocationSettings() { await platform.settings.openSettings(); },
    async openBatterySettings() {
      await platform.intents.startActivityAsync(ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      kv.set('battery_prompt_done', '1');
    },
    async openBackgroundSettings() { await platform.settings.openSettings(); },
    async readRows() {
      const [location, background, batteryOptimizationEnabled, camera] = await Promise.all([
        readLocationState(platform.location), platform.location.getBackgroundPermissionsAsync(),
        platform.battery.isBatteryOptimizationEnabledAsync(), platform.camera.getCameraPermissionsAsync(),
      ]);
      return { location, backgroundLocation: permissionState(background),
        batteryOptimizationEnabled, camera: permissionState(camera) };
    },
    async requestCamera() { return (await platform.camera.requestCameraPermissionsAsync()).granted; },
    async openCameraSettings() { await platform.settings.openSettings(); },
    async start() {
      if (subscription !== undefined || disposed) return;
      subscription = platform.appState.addEventListener('change', (state) => {
        if (state === 'active') {
          // A failed native read never invents a grant. Consumers can retry a read.
          void readLocationState(platform.location).then(publish).catch(() => {});
        }
      });
      publish(await readLocationState(platform.location));
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; subscription?.remove(); listeners.clear(); },
  };
}
