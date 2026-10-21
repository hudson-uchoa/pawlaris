import * as Battery from 'expo-battery';
import { Camera } from 'expo-camera';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { AppState, Linking, Platform } from 'react-native';
import { createExpoNotifications, type NotificationsPort } from '../notifications/port';

export type LocationPort = Pick<typeof Location,
  | 'getForegroundPermissionsAsync' | 'requestForegroundPermissionsAsync'
  | 'getBackgroundPermissionsAsync' | 'requestBackgroundPermissionsAsync'>;

export interface WalkPermissionsPort {
  location: LocationPort;
  notifications: Pick<NotificationsPort, 'getPermissionsAsync' | 'requestPermissionsAsync'>;
  battery: Pick<typeof Battery, 'isBatteryOptimizationEnabledAsync'>;
  camera: Pick<typeof Camera, 'getCameraPermissionsAsync' | 'requestCameraPermissionsAsync'>;
  intents: Pick<typeof IntentLauncher, 'startActivityAsync'>;
  settings: Pick<typeof Linking, 'openSettings'>;
  appState: Pick<typeof AppState, 'currentState' | 'addEventListener'>;
  manufacturer: typeof Device.manufacturer;
  androidVersion: number;
}

export function createExpoWalkPermissions(): WalkPermissionsPort {
  return {
    location: Location, notifications: createExpoNotifications(), battery: Battery,
    camera: Camera, intents: IntentLauncher, settings: Linking, appState: AppState,
    manufacturer: Device.manufacturer, androidVersion: Number(Platform.Version),
  };
}
