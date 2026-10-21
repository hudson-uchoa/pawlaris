import { act, cleanup, render, screen } from '@testing-library/react-native';
import { PermissionStatus } from 'expo';
import { ExpoRoot } from 'expo-router';
import * as Location from 'expo-location';
import Walks from '../../../../app/(tabs)/walks';
import { AppProvider } from '../../../appContext';
import { deferred, servers } from '../../../auth/__tests__/support';
import { createAppRuntime, type AppRuntime } from '../../../bootstrap';
import { strings } from '../../../i18n/strings';
import { fakeCamera } from '../../../testing/fakeCamera';
import { fakeLogFiles } from '../../../testing/fakeLogFiles';
import { fakeNotifications } from '../../../testing/fakeNotifications';
import { fakeWebSocket } from '../../../testing/fakeWebSocket';
import { dark, light } from '../../../ui/tokens/color';
import { historyContext, type HistoryContext } from '../../../walks/__tests__/historySupport';

jest.mock('expo-location', () => ({ ...jest.requireActual<typeof import('expo-location')>('expo-location') }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
}));

type AnimationAPI = typeof import('react-native-reanimated');
const appearance = jest.requireActual<Pick<typeof import('react-native'), 'useColorScheme'>>('react-native');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const reducedMotion = jest.requireActual<Pick<AnimationAPI, 'useReducedMotion'>>(`${animationRoot}/hook/useReducedMotion`);
const repeatingAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);

let c: HistoryContext;
let runtime: AppRuntime;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden'));
  c = await historyContext();
  c.seedPet({ species: 'dog', name: 'Katarina' });
  c.seedWalk({ status: 'finished', has_route: false });
  runtime = createAppRuntime({ ...c, servers, online: false,
    WebSocketImpl: fakeWebSocket().WebSocketImpl, camera: fakeCamera(c.fileSystem).device,
    notifications: fakeNotifications().platform, logFiles: fakeLogFiles(),
    documentDirectory: 'file:///fake/documents/', perfOutput: jest.fn() });
});

afterEach(async () => {
  await cleanup();
  runtime.dispose();
  c.dispose();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

function locationResponse(granted: boolean): Location.LocationPermissionResponse {
  return { granted, canAskAgain: true, expires: 'never',
    status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
    android: { accuracy: granted ? 'fine' : 'none' } };
}

async function paint(): Promise<void> {
  const routes = { './index.tsx': { default: () => <AppProvider runtime={runtime}><Walks /></AppProvider> } };
  function requireRoute<T>(key: string): T {
    if (key !== './index.tsx') throw new Error(`Missing test route ${key}`);
    return routes[key] as T;
  }
  const context = Object.assign(requireRoute, {
    keys: () => Object.keys(routes), resolve: (key: string) => key, id: 'walks-review-route',
  });
  await render(<ExpoRoot context={context} location="/" />);
}

test.each([
  ['light', false], ['light', true], ['dark', false], ['dark', true],
] as const)(
  '09 section 6.1 first permission read shows a skeleton then granted content in %s (reduced=%s)',
  async (scheme, reduced) => {
    jest.spyOn(appearance, 'useColorScheme').mockReturnValue(scheme);
    jest.spyOn(reducedMotion, 'useReducedMotion').mockReturnValue(reduced);
    const repeat = jest.spyOn(repeatingAnimation, 'withRepeat');
    const pending = deferred<Location.LocationPermissionResponse>();
    jest.spyOn(Location, 'getForegroundPermissionsAsync').mockImplementation(() => pending.promise);
    const request = jest.spyOn(Location, 'requestForegroundPermissionsAsync');
    await paint();
    expect(screen.queryByText(strings.location.rationale)).toBeNull();
    expect(screen.queryByRole('button', { name: strings.location.allow })).toBeNull();
    const skeleton = screen.getByTestId('walk-permission-loading', { includeHiddenElements: true });
    expect(skeleton).toHaveStyle({ backgroundColor: (scheme === 'light' ? light : dark).surfaceSunken });
    if (reduced) expect(repeat).not.toHaveBeenCalled();
    else expect(repeat).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('walk-start')).toBeDisabled();
    expect(screen.getAllByTestId(/^walk-row-/)).toHaveLength(1);
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled();
    await act(async () => { pending.resolve(locationResponse(true)); });
    expect(screen.queryByTestId('walk-permission-loading', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(strings.location.rationale)).toBeNull();
    expect(screen.queryByRole('button', { name: strings.location.allow })).toBeNull();
    expect(screen.getByTestId('walk-start')).toBeEnabled();
    expect(request).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

test('09 section 6.1 a denied read replaces the permission skeleton with the rationale', async () => {
  jest.spyOn(reducedMotion, 'useReducedMotion').mockReturnValue(true);
  const pending = deferred<Location.LocationPermissionResponse>();
  jest.spyOn(Location, 'getForegroundPermissionsAsync').mockImplementation(() => pending.promise);
  await paint();
  expect(screen.getByTestId('walk-permission-loading', { includeHiddenElements: true })).toBeOnTheScreen();
  await act(async () => { pending.resolve(locationResponse(false)); });
  expect(screen.queryByTestId('walk-permission-loading', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText(strings.location.rationale)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: strings.location.allow })).toBeOnTheScreen();
  expect(screen.getByTestId('walk-start')).toBeDisabled();
});
