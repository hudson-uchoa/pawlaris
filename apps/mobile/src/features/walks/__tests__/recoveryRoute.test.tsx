import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';
import RootLayout from '../../../../app/_layout';
import { servers, wireSession } from '../../../auth/__tests__/support';
import * as Bootstrap from '../../../bootstrap';
import type { AppRuntime } from '../../../bootstrap';
import { strings } from '../../../i18n/strings';
import { fakeFileSystem } from '../../../testing/fakeFileSystem';
import { fakeHttp } from '../../../testing/fakeHttp';
import { fakeLogFiles } from '../../../testing/fakeLogFiles';
import { fakeNotifications } from '../../../testing/fakeNotifications';
import { fakeRandom } from '../../../testing/fakeRandom';
import { fakeSecretBox } from '../../../testing/fakeSecretBox';
import { fakeWebSocket } from '../../../testing/fakeWebSocket';
import { sequentialIds } from '../../../testing/sequentialIds';
import { trackPoint, trackingStorage } from '../../../walks/__tests__/trackingSupport';
import { createTracker } from '../../../walks/tracker';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 }, startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(), watchPositionAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(), hasStartedLocationUpdatesAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof import('expo-router')>('expo-router'),
  useRouter: jest.fn(),
}));
jest.mock('expo-router/stack', () => ({
  Stack: Object.assign(() => null, { Screen: () => null, Protected: () => null }),
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => {}),
}));
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default);

const initialAppState = AppState.currentState;
const navigation = { navigate: jest.fn(), push: jest.fn() };
let c: Awaited<ReturnType<typeof trackingStorage>>;
let runtime: AppRuntime | undefined;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  jest.clearAllMocks();
  jest.spyOn(NetInfo, 'addEventListener').mockImplementation(() => () => {});
  AppState.currentState = 'active';
  jest.mocked(useRouter).mockReturnValue(navigation as unknown as ReturnType<typeof useRouter>);
  jest.mocked(Location.startLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.stopLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
  c = await trackingStorage();
  c.kv.set('session_user', JSON.stringify(wireSession('primary').user));
});

afterEach(async () => {
  await cleanup();
  await runtime?.liveWalk.tracker.stop();
  runtime?.dispose();
  runtime = undefined;
  c.driver.close();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function paintOrphan() {
  const tracker = createTracker({ ...c, location: Location,
    async requestBackgroundLocation() { return false; } });
  const walk = await tracker.start(c.pet.id);
  c.points.append(walk.id, trackPoint(c.clock.now()));
  c.clock.advance(3000);
  c.points.append(walk.id, trackPoint(c.clock.now(), 1));
  // The root creates a new tracker over the orphan's durable local data.
  const createAppRuntime = Bootstrap.createAppRuntime;
  jest.spyOn(Bootstrap, 'createAppRuntime').mockImplementation((dependencies) => {
    const app = createAppRuntime(dependencies);
    runtime = app;
    return app;
  });
  await render(<RootLayout dependencies={{ driver: c.driver, clock: c.clock,
    ids: sequentialIds(), servers, online: false, http: fakeHttp(), secretBox: fakeSecretBox(),
    random: fakeRandom(0.5), fileSystem: fakeFileSystem(), logFiles: fakeLogFiles(),
    documentDirectory: 'file:///fake/documents/', WebSocketImpl: fakeWebSocket().WebSocketImpl,
    notifications: fakeNotifications().platform,
  }} />);
  const app = runtime;
  if (app === undefined) throw new Error('The root did not initialize its runtime');
  await act(async () => {
    app.afterFirstPaint();
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(app.walkRecovery.getSnapshot()).toMatchObject({ walk });
  expect(screen.getByTestId('walk-recovery')).toBeOnTheScreen();
  expect(navigation.navigate).not.toHaveBeenCalled();
  return { app, walk };
}

test('R4.6 R2 the root recovery action continues through the runtime to walk/live', async () => {
  const { app, walk } = await paintOrphan();
  const points = c.points.read(walk.id);
  jest.mocked(Location.startLocationUpdatesAsync).mockClear();
  await fireEvent.press(screen.getByRole('button', { name: strings.walks.resume }));
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).toHaveBeenCalledWith('/walk/live');
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(app.walkRecovery.getSnapshot()).toBeNull();
  expect(c.walks.getLocal()?.id).toBe(walk.id);
  expect(c.points.read(walk.id)).toEqual(points);
  expect(c.outbox.count()).toBe(1);
});

test('R4.6 R2 the root recovery action finishes a fresh orphan to walk/[id]', async () => {
  const { app, walk } = await paintOrphan();
  await fireEvent.press(screen.getByRole('button', { name: strings.walks.recoveryFinish }));
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).toHaveBeenCalledWith({ pathname: '/walk/[id]', params: { id: walk.id } });
  expect(app.walkRecovery.getSnapshot()).toBeNull();
  expect(app.store.getState().walks[walk.id]?.status).toBe('finished');
  expect(c.walks.getLocal()).toBeNull();
  expect(c.outbox.count()).toBe(2);
});
