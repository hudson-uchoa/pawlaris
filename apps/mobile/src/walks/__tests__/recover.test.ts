import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { AppState, type AppStateStatus } from 'react-native';
import { servers, wireSession } from '../../auth/__tests__/support';
import { createAppRuntime, type AppRuntime } from '../../bootstrap';
import { fakeFileSystem } from '../../testing/fakeFileSystem';
import { fakeHttp } from '../../testing/fakeHttp';
import { fakeLogFiles } from '../../testing/fakeLogFiles';
import { fakeNotifications } from '../../testing/fakeNotifications';
import { fakeRandom } from '../../testing/fakeRandom';
import { fakeSecretBox } from '../../testing/fakeSecretBox';
import { fakeWebSocket } from '../../testing/fakeWebSocket';
import { sequentialIds } from '../../testing/sequentialIds';
import { createTracker } from '../tracker';
import { WALK_LOCATION_TASK } from '../task';
import { trackPoint, trackingStorage } from './trackingSupport';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 }, startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(), watchPositionAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(), hasStartedLocationUpdatesAsync: jest.fn(),
}));

const initialState = AppState.currentState;
const listeners = new Set<(state: AppStateStatus) => void>();
let c: Awaited<ReturnType<typeof trackingStorage>>;
let runtime: AppRuntime | undefined;
let nativeRunning: boolean;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  jest.clearAllMocks();
  AppState.currentState = 'active';
  nativeRunning = false;
  jest.spyOn(NetInfo, 'addEventListener').mockImplementation(() => () => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove() { listeners.delete(listener); } };
  });
  jest.mocked(Location.startLocationUpdatesAsync).mockImplementation(async () => { nativeRunning = true; });
  jest.mocked(Location.stopLocationUpdatesAsync).mockImplementation(async () => { nativeRunning = false; });
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockImplementation(async () => nativeRunning);
  c = await trackingStorage();
  c.kv.set('session_user', JSON.stringify(wireSession('primary').user));
});

afterEach(() => {
  runtime?.dispose();
  runtime = undefined;
  c.driver.close();
  listeners.clear();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialState;
});

function changeState(state: AppStateStatus): void {
  AppState.currentState = state;
  for (const listener of [...listeners]) listener(state);
}

async function scene() {
  const tracker = createTracker({ ...c, location: Location,
    async requestBackgroundLocation() { return false; } });
  const walk = await tracker.start(c.pet.id);
  c.points.append(walk.id, trackPoint(c.clock.now()));
  c.clock.advance(3000);
  c.points.append(walk.id, trackPoint(c.clock.now(), 1));
  const http = fakeHttp();
  runtime = createAppRuntime({ driver: c.driver, clock: c.clock,
    ids: sequentialIds(), servers, online: false, http, secretBox: fakeSecretBox(),
    random: fakeRandom(0.5), fileSystem: fakeFileSystem(), logFiles: fakeLogFiles(),
    documentDirectory: 'file:///fake/documents/', WebSocketImpl: fakeWebSocket().WebSocketImpl,
    notifications: fakeNotifications().platform,
  });
  return { app: runtime, walk, http };
}

test('R4.6 startup checks for an orphaned local_walk after the first paint', async () => {
  const { app, walk, http } = await scene();
  nativeRunning = false;
  const points = c.points.read(walk.id);
  const outbox = c.driver.all('SELECT * FROM outbox ORDER BY seq');
  expect(Location.hasStartedLocationUpdatesAsync).not.toHaveBeenCalled();
  app.afterFirstPaint();
  await jest.advanceTimersByTimeAsync(0);
  expect(Location.hasStartedLocationUpdatesAsync).toHaveBeenCalledWith(WALK_LOCATION_TASK);
  expect(c.walks.getLocal()?.id).toBe(walk.id);
  expect(c.points.read(walk.id)).toEqual(points);
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(outbox);
  expect(http.requests).toEqual([]);
});

test('R4.6 foreground checks again when tracking stops after startup', async () => {
  const { app, walk, http } = await scene();
  app.afterFirstPaint();
  await jest.advanceTimersByTimeAsync(0);
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockClear();
  changeState('background');
  nativeRunning = false;
  const points = c.points.read(walk.id);
  const outbox = c.driver.all('SELECT * FROM outbox ORDER BY seq');
  changeState('active');
  await jest.advanceTimersByTimeAsync(0);
  expect(Location.hasStartedLocationUpdatesAsync).toHaveBeenCalledWith(WALK_LOCATION_TASK);
  expect(c.walks.getLocal()?.id).toBe(walk.id);
  expect(c.points.read(walk.id)).toEqual(points);
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(outbox);
  expect(http.requests).toEqual([]);
});

test('R4.6 runtime publishes recovery after first paint and clears listeners on disposal', async () => {
  const { app, walk } = await scene();
  nativeRunning = false;
  const listener = jest.fn();
  app.walkRecovery.subscribe(listener);
  expect(app.walkRecovery.getSnapshot()).toBeNull();
  app.afterFirstPaint();
  await jest.advanceTimersByTimeAsync(0);
  expect(app.walkRecovery.getSnapshot()).toMatchObject({ walk });
  expect(app.walkRecovery.getSnapshot()?.distanceM).toBe(c.points.rebuild(walk.id).snapshot().distanceM);
  expect(listener).toHaveBeenCalledTimes(1);
  app.dispose();
  changeState('background');
  changeState('active');
  await jest.advanceTimersByTimeAsync(0);
  expect(app.walkRecovery.getSnapshot()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
});
