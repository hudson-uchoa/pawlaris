import {
  changeAppState, locationResponse, permissionContext, permissionResponse,
  resetWalkPlatform, restoreWalkPlatform,
} from '../../../walks/__tests__/support';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Battery from 'expo-battery';
import { Camera } from 'expo-camera';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import { strings } from '../../../i18n/strings';
import { createLocationPermissions } from '../../../walks/permissions';
import { LocationPermissionScreen } from '../LocationPermissionScreen';
import { WalkPermissionRows } from '../WalkPermissionRows';

let c: Awaited<ReturnType<typeof permissionContext>>;

beforeEach(async () => { resetWalkPlatform(); c = await permissionContext(); });
afterEach(async () => {
  await cleanup(); c.permissions.dispose(); c.driver.close(); restoreWalkPlatform();
});

test('R4.1 the normal ladder completes after explicit location, notification and battery actions', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
    return locationResponse('granted');
  });
  jest.mocked(Notifications.requestPermissionsAsync).mockImplementation(async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
    return permissionResponse(true);
  });
  const onComplete = jest.fn();
  await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={onComplete} />);
  await fireEvent.press(screen.getByRole('button', { name: strings.location.allow }));
  await fireEvent.press(await screen.findByRole('button', { name: strings.notifications.activate }));
  expect(await screen.findByText(strings.location.batteryRationale)).toBeOnTheScreen();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: strings.location.settings }));
  await waitFor(() => { expect(onComplete).toHaveBeenCalledWith('service'); });
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  );
  expect(c.kv.get('battery_prompt_done')).toBe('1');
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test('R4.4 approximate location stays gated until a foreground re-read sees precise', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('approximate'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  c.kv.set('battery_prompt_done', '1');
  const onComplete = jest.fn();
  await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={onComplete} />);
  expect(screen.getByText(strings.location.preciseRequired)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: strings.location.settings }));
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(onComplete).not.toHaveBeenCalled();
  await act(async () => {
    changeAppState('background');
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
    changeAppState('active');
  });
  await waitFor(() => { expect(onComplete).toHaveBeenCalledWith('service'); });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test.each(['Xiaomi', 'Samsung', 'Motorola', null])(
  'R4.1 battery rationale provides two help lines for manufacturer %s', async (manufacturer) => {
    const permissions = createLocationPermissions({ kv: c.kv, clock: c.clock,
      platform: { ...c.platform, manufacturer } });
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
    await render(<LocationPermissionScreen permissions={permissions} active onComplete={jest.fn()} />);
    const key = manufacturer === 'Xiaomi' ? 'xiaomi' : manufacturer === 'Samsung' ? 'samsung'
      : manufacturer === 'Motorola' ? 'motorola' : 'other';
    for (const line of strings.location.batteryHelp[key]) expect(screen.getByText(line)).toBeOnTheScreen();
    permissions.dispose();
  },
);

test('09 section 7 permission rows request the camera and refresh the battery and location on foreground', async () => {
  jest.mocked(Camera.requestCameraPermissionsAsync).mockImplementation(async () => {
    jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue(permissionResponse(true));
    return permissionResponse(true);
  });
  await render(<WalkPermissionRows permissions={c.permissions} active onLocation={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.camera }));
  expect(screen.getByTestId('permission-camera')).toHaveTextContent(strings.diagnostics.granted, { exact: false });
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.camera }));
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.backgroundLocation }));
  expect(Linking.openSettings).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.battery }));
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    changeAppState('background');
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('blocked'));
    jest.mocked(Battery.isBatteryOptimizationEnabledAsync).mockResolvedValue(false);
    changeAppState('active');
  });
  expect(screen.getByTestId('permission-location')).toHaveTextContent(strings.location.blocked, { exact: false });
  expect(screen.getByTestId('permission-battery')).toHaveTextContent(strings.location.disabled, { exact: false });
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.location }));
  expect(Linking.openSettings).toHaveBeenCalledTimes(3);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});
