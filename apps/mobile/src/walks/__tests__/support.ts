import * as Battery from 'expo-battery';
import { Camera } from 'expo-camera';
import { PermissionStatus, type PermissionResponse } from 'expo';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { Kv } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { fakeClock } from '../../testing/fakeClock';
import { memoryDriver } from '../../testing/memoryDriver';
import { createLocationPermissions, type LocationState } from '../permissions';
import { createExpoWalkPermissions } from '../port';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: jest.fn() }));
jest.mock('expo-camera', () => ({ Camera: {
  getCameraPermissionsAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn(),
} }));
jest.mock('expo-device', () => ({ manufacturer: 'Motorola' }));
jest.mock('expo-intent-launcher', () => ({
  ActivityAction: { IGNORE_BATTERY_OPTIMIZATION_SETTINGS: 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS' },
  startActivityAsync: jest.fn(),
}));

export function permissionResponse(granted: boolean, canAskAgain = true): PermissionResponse {
  return { granted, canAskAgain, expires: 'never',
    status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED };
}

export function locationResponse(state: LocationState): Location.LocationPermissionResponse {
  return { ...permissionResponse(state === 'granted' || state === 'approximate', state !== 'blocked'),
    android: { accuracy: state === 'granted' ? 'fine' : state === 'approximate' ? 'coarse' : 'none' } };
}

const listeners = new Set<(state: AppStateStatus) => void>();
const initialState = AppState.currentState;

export function resetWalkPlatform(androidVersion = 34): void {
  jest.clearAllMocks();
  listeners.clear();
  AppState.currentState = 'active';
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(androidVersion);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') listeners.add(listener as (state: AppStateStatus) => void);
    return { remove() { listeners.delete(listener as (state: AppStateStatus) => void); } };
  });
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('denied'));
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(permissionResponse(false));
  jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue(permissionResponse(true));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(false));
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(permissionResponse(true));
  jest.mocked(Battery.isBatteryOptimizationEnabledAsync).mockResolvedValue(true);
  jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue(permissionResponse(false));
  jest.mocked(Camera.requestCameraPermissionsAsync).mockResolvedValue(permissionResponse(true));
  jest.mocked(IntentLauncher.startActivityAsync).mockResolvedValue({ resultCode: 0 });
}

export function restoreWalkPlatform(): void {
  listeners.clear();
  jest.restoreAllMocks();
  AppState.currentState = initialState;
}

export function changeAppState(state: AppStateStatus): void {
  AppState.currentState = state;
  for (const listener of [...listeners]) listener(state);
}

export async function permissionContext(data?: Uint8Array) {
  const driver = await memoryDriver(data);
  openDatabase(driver);
  const kv = new Kv(driver);
  const clock = fakeClock(Date.parse('2026-10-21T15:00:00Z'));
  const platform = createExpoWalkPermissions();
  return { driver, kv, clock, platform,
    permissions: createLocationPermissions({ kv, clock, platform }) };
}
