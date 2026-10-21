import {
  changeAppState, locationResponse, permissionContext, permissionResponse,
  resetWalkPlatform, restoreWalkPlatform,
} from './support';
import * as Location from 'expo-location';
import { PermissionStatus } from 'expo';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';
import { readLocationState, type LocationState } from '../permissions';

let c: Awaited<ReturnType<typeof permissionContext>>;

beforeEach(async () => {
  resetWalkPlatform();
  c = await permissionContext();
});

afterEach(() => { c.driver.close(); restoreWalkPlatform(); });

describe('R4.4 09 section 8.1 location state table', () => {
  test.each<LocationState>(['granted', 'approximate', 'denied', 'blocked'])(
    'R4.4 maps the foreground response to %s without requesting permission', async (state) => {
      jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse(state));
      expect(await readLocationState(c.platform.location)).toBe(state);
      expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    },
  );

  test('R4.4 an undetermined permission that can ask again is denied', async () => {
    const response = { ...locationResponse('denied'), status: PermissionStatus.UNDETERMINED };
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response);
    expect(await readLocationState(c.platform.location)).toBe('denied');
  });

  test('R4.4 a coarse grant remains approximate even when canAskAgain is false', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
      ...locationResponse('approximate'), canAskAgain: false,
    });
    expect(await readLocationState(c.platform.location)).toBe('approximate');
  });
});

test.each<LocationState>(['granted', 'approximate', 'denied', 'blocked'])(
  'R4.4 re-reads and publishes %s after returning from system Settings', async (next) => {
    const initial = next === 'granted' ? 'denied' : 'granted';
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse(initial));
    const states: LocationState[] = [];
    await c.permissions.start();
    const unsubscribe = c.permissions.subscribe((state) => { states.push(state); });
    expect(await c.permissions.readLocationState()).toBe(initial);
    const readsBeforeBackground = jest.mocked(Location.getForegroundPermissionsAsync).mock.calls.length;
    changeAppState('background');
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse(next));
    c.clock.advance(60_000);
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(readsBeforeBackground);
    changeAppState('active');
    // The native read is asynchronous; no elapsed real time is needed.
    await Promise.resolve();
    await Promise.resolve();
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(readsBeforeBackground + 1);
    expect(states.at(-1)).toBe(next);
    expect(await c.permissions.readLocationState()).toBe(next);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    unsubscribe();
    c.permissions.dispose();
    const readsAfterDispose = jest.mocked(Location.getForegroundPermissionsAsync).mock.calls.length;
    changeAppState('background');
    changeAppState('active');
    await Promise.resolve();
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(readsAfterDispose);
  },
);

test('R4.1 09 section 8.2 the normal ladder orders location, notifications and battery', async () => {
  expect(await c.permissions.readLadder()).toEqual(['location', 'notifications', 'battery']);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test.each([32, 33, 34])('R4.1 notification step is conditional on Android 13+ (API %s)', async (version) => {
  restoreWalkPlatform();
  resetWalkPlatform(version);
  const permissions = (await newContext()).permissions;
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  c.kv.set('battery_prompt_done', '1');
  expect(await permissions.readLadder()).toEqual(version >= 33 ? ['notifications'] : []);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  expect(await permissions.readLadder()).toEqual([]);
});

test.each([false, true])('R1 R4.1 notification answer persists the prompt and advances the ladder (granted=%s)', async (granted) => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.requestPermissionsAsync).mockImplementation(async () => {
    const response = permissionResponse(granted);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(response);
    return response;
  });
  expect(await c.permissions.readLadder()).toEqual(['notifications', 'battery']);
  expect(await c.permissions.requestNotifications()).toBe(granted);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(c.kv.get('notifications_prompt_done')).toBe('1');
  expect(await c.permissions.readLadder()).toEqual(['battery']);
});

test('R1 R4.1 a persisted notification prompt stays skipped across foreground and restart', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(false, false));
  c.kv.set('notifications_prompt_done', '1');
  expect(await c.permissions.readLadder()).toEqual(['battery']);
  await c.permissions.start();
  changeAppState('background');
  changeAppState('active');
  expect(await c.permissions.readLadder()).toEqual(['battery']);
  const restarted = await permissionContext(c.driver.export());
  try {
    expect(await restarted.permissions.readLadder()).toEqual(['battery']);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  } finally { restarted.driver.close(); c.permissions.dispose(); }
});

// Keep each real SQLite connection open until the test that owns it ends.
async function newContext() {
  c.driver.close();
  c = await permissionContext();
  return c;
}

test('R4.1 requestLocation maps the system result and never requests background permission', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(locationResponse('approximate'));
  expect(await c.permissions.requestLocation()).toBe('approximate');
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test.each([false, true])('R4.3 09 section 8.2 step 3b requires the persisted flag (set=%s)', async (flag) => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  c.kv.set('battery_prompt_done', '1');
  if (flag) c.kv.set('needs_background_location', '1');
  const restarted = await permissionContext(c.driver.export());
  try {
    expect(await restarted.permissions.readLadder()).toEqual(flag ? ['backgroundLocation'] : []);
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  } finally { restarted.driver.close(); }
});

test('R4.8 09 section 8.2 battery prompt is persisted once across a restart', async () => {
  await c.permissions.openBatterySettings();
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
  expect(c.kv.get('battery_prompt_done')).toBe('1');
  const restarted = await permissionContext(c.driver.export());
  try { expect(await restarted.permissions.readLadder()).not.toContain('battery'); }
  finally { restarted.driver.close(); }
});

test('R4.3 09 section 8.2 the fallback action opens system Settings', async () => {
  c.kv.set('needs_background_location', '1');
  await c.permissions.openBackgroundSettings();
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});
