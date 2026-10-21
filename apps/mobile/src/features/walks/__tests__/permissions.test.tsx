import {
  locationResponse, permissionContext, permissionResponse, resetWalkPlatform, restoreWalkPlatform,
} from '../../../walks/__tests__/support';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';
import { strings } from '../../../i18n/strings';
import type { LocationState } from '../../../walks/permissions';
import { Text } from '../../../ui/primitives/Text';
import { PermissionsScreen } from '../../settings/PermissionsScreen';
import { PermissionGate } from '../PermissionGate';
import { LocationPermissionScreen } from '../LocationPermissionScreen';

let c: Awaited<ReturnType<typeof permissionContext>>;

beforeEach(async () => { resetWalkPlatform(); c = await permissionContext(); });
afterEach(async () => { await cleanup(); c.driver.close(); restoreWalkPlatform(); });

describe('PermissionGate 07 section 7', () => {
  async function gate(state: LocationState) {
    const onRequest = jest.fn();
    await render(<PermissionGate state={state} active onRequest={onRequest}
      onOpenSettings={() => { void Linking.openSettings(); }}>
      <Text testID="walk-content">{strings.tabs.walks}</Text>
    </PermissionGate>);
    return { onRequest };
  }

  test('R4.4 renders children when granted', async () => {
    await gate('granted');
    expect(screen.getByTestId('walk-content')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('R4.4 asks for precise location when approximate and opens Settings', async () => {
    const { onRequest } = await gate('approximate');
    expect(screen.getByText(strings.location.preciseRequired)).toBeOnTheScreen();
    expect(screen.queryByTestId('walk-content')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: strings.location.settings }));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(onRequest).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  test('R4.4 offers Settings when blocked', async () => {
    const { onRequest } = await gate('blocked');
    await fireEvent.press(screen.getByRole('button', { name: strings.location.settings }));
    expect(screen.queryByTestId('walk-content')).toBeNull();
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(onRequest).not.toHaveBeenCalled();
  });

  test('R4.1 R4.4 denied offers the rationale ladder before a system request', async () => {
    const { onRequest } = await gate('denied');
    await fireEvent.press(screen.getByRole('button', { name: strings.location.allow }));
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('walk-content')).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });
});

test('R4.1 09 section 8.2 location is a single rationale step before the native prompt', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
    return locationResponse('granted');
  });
  await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={jest.fn()} />);
  expect(screen.getByText(strings.location.rationale)).toBeOnTheScreen();
  expect(screen.queryByText(strings.location.notificationRationale)).toBeNull();
  expect(screen.queryByText(strings.location.batteryRationale)).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button'));
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(strings.location.notificationRationale)).toBeOnTheScreen();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test('R4.3 09 section 8.2 no step 3b without kv.needs_background_location', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  // Missing background permission alone must never opt a phone into step 3b.
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(permissionResponse(false, false));
  await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={jest.fn()} />);
  expect(await screen.findByText(strings.location.batteryRationale)).toBeOnTheScreen();
  expect(screen.queryByText(strings.location.backgroundTitle)).toBeNull();
  expect(screen.queryByText(strings.location.backgroundRationale)).toBeNull();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test('R4.3 09 section 8.2 a persisted fallback flag shows step 3b after a restart', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  c.kv.set('battery_prompt_done', '1');
  c.kv.set('needs_background_location', '1');
  const restarted = await permissionContext(c.driver.export());
  try {
    await render(<LocationPermissionScreen permissions={restarted.permissions} active onComplete={jest.fn()} />);
    expect(await screen.findByText(strings.location.backgroundTitle)).toBeOnTheScreen();
    expect(screen.getByText(strings.location.backgroundRationale)).toBeOnTheScreen();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: strings.location.settings }));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  } finally { await cleanup(); restarted.driver.close(); }
});

test('R4.3 09 section 8.2 declining step 3b explicitly selects foreground recording', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  c.kv.set('battery_prompt_done', '1');
  c.kv.set('needs_background_location', '1');
  const onComplete = jest.fn();
  await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={onComplete} />);
  await fireEvent.press(await screen.findByRole('button', { name: strings.notifications.later }));
  expect(onComplete).toHaveBeenCalledWith('foreground');
  expect(c.kv.get('needs_background_location')).toBe('1');
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Linking.openSettings).not.toHaveBeenCalled();
});

test('R2 R4.3 step 3b stays absent with the fallback flag set and background location granted', async () => {
  c.kv.set('needs_background_location', '1');
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(permissionResponse(true));
  expect(await c.permissions.readLadder()).not.toContain('backgroundLocation');
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test('R4.1 09 section 8.2 completed normal steps finish without a background request', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResponse('granted'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permissionResponse(true));
  c.kv.set('battery_prompt_done', '1');
  const onComplete = jest.fn();
  await render(<LocationPermissionScreen permissions={c.permissions} active onComplete={onComplete} />);
  expect(onComplete).toHaveBeenCalledWith('service');
  expect(screen.queryByText(strings.location.backgroundTitle)).toBeNull();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test('09 section 7 P6-1 Permissions supplies live location, background, battery and camera rows', async () => {
  const onLocation = jest.fn();
  await render(<PermissionsScreen walkPermissions={c.permissions} active onLocation={onLocation} />);
  for (const permission of ['location', 'backgroundLocation', 'battery', 'camera'] as const) {
    expect(screen.getByTestId(`permission-${permission}`)).toHaveTextContent(strings.diagnostics[permission], { exact: false });
    if (permission !== 'battery') {
      expect(screen.getByTestId(`permission-${permission}`)).toHaveTextContent(strings.diagnostics.denied, { exact: false });
    }
  }
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.location }));
  expect(onLocation).toHaveBeenCalledTimes(1);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('R2 09 section 7 a permanent background location refusal renders the blocked row state', async () => {
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(permissionResponse(false, false));
  expect((await c.permissions.readRows()).backgroundLocation).toBe('blocked');
  await render(<PermissionsScreen walkPermissions={c.permissions} active onLocation={jest.fn()} />);
  expect(screen.getByTestId('permission-backgroundLocation')).toHaveTextContent(strings.location.blocked, { exact: false });
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});
