import {
  changeAppState, locationResponse, permissionContext, permissionResponse,
  resetWalkPlatform, restoreWalkPlatform,
} from '../../../walks/__tests__/support';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { strings } from '../../../i18n/strings';
import { LocationPermissionScreen } from '../LocationPermissionScreen';

let c: Awaited<ReturnType<typeof permissionContext>>;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  resetWalkPlatform();
  c = await permissionContext();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
});

afterEach(async () => {
  await cleanup();
  c.permissions.dispose();
  c.driver.close();
  restoreWalkPlatform();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('R4.8 the battery step shows once across foreground and a SQLite restart even without exemption', async () => {
  const completions: string[] = [];
  const onComplete = (mode: string): void => { completions.push(mode); };
  const first = await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={onComplete} />);
  expect(screen.getByText(strings.location.batteryRationale)).toBeOnTheScreen();
  for (const line of strings.location.batteryHelp.motorola) expect(screen.getByText(line)).toBeOnTheScreen();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: strings.location.settings }));
  expect(c.kv.get('battery_prompt_done')).toBe('1');
  expect(completions).toEqual(['service']);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  );
  // Returning from Settings without granting an exemption must not nag again.
  expect(await Battery.isBatteryOptimizationEnabledAsync()).toBe(true);
  await act(async () => { changeAppState('background'); changeAppState('active'); });
  expect(screen.queryByText(strings.location.batteryRationale)).toBeNull();
  await first.unmount();
  const restarted = await permissionContext(c.driver.export());
  try {
    await render(<LocationPermissionScreen permissions={restarted.permissions} active onComplete={onComplete} />);
    expect(screen.queryByText(strings.location.batteryRationale)).toBeNull();
    expect(await restarted.permissions.readLadder()).not.toContain('battery');
    expect(completions).toEqual(['service', 'service']);
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
    expect(restarted.kv.get('battery_prompt_done')).toBe('1');
  } finally {
    await cleanup();
    restarted.permissions.dispose();
    restarted.driver.close();
  }
});
