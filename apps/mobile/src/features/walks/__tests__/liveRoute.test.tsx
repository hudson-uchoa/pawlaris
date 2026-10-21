import { resetLivePlatform } from './liveSupport';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';
import LiveWalk from '../../../../app/walk/live';
import { AppProvider } from '../../../appContext';
import { servers, wireSession } from '../../../auth/__tests__/support';
import { createAppRuntime, type AppRuntime } from '../../../bootstrap';
import { fakeFileSystem } from '../../../testing/fakeFileSystem';
import { fakeHttp } from '../../../testing/fakeHttp';
import { fakeLogFiles } from '../../../testing/fakeLogFiles';
import { fakeNotifications } from '../../../testing/fakeNotifications';
import { fakeRandom } from '../../../testing/fakeRandom';
import { fakeSecretBox } from '../../../testing/fakeSecretBox';
import { fakeWebSocket } from '../../../testing/fakeWebSocket';
import { sequentialIds } from '../../../testing/sequentialIds';
import { trackingStorage } from '../../../walks/__tests__/trackingSupport';

jest.mock('expo-router', () => ({ useIsFocused: () => true, useRouter: jest.fn() }));

const initialAppState = AppState.currentState;
let c: Awaited<ReturnType<typeof trackingStorage>>;
let runtime: AppRuntime | undefined;
const navigation = { replace: jest.fn(), push: jest.fn() };

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  resetLivePlatform();
  AppState.currentState = 'active';
  jest.mocked(useRouter).mockReturnValue(navigation as unknown as ReturnType<typeof useRouter>);
  c = await trackingStorage();
  c.kv.set('session_user', JSON.stringify(wireSession('primary').user));
  runtime = createAppRuntime({ driver: c.driver, clock: c.clock,
    ids: sequentialIds(), servers, online: false, http: fakeHttp(), secretBox: fakeSecretBox(),
    random: fakeRandom(0.5), fileSystem: fakeFileSystem(), logFiles: fakeLogFiles(),
    documentDirectory: 'file:///fake/documents/', WebSocketImpl: fakeWebSocket().WebSocketImpl,
    notifications: fakeNotifications().platform,
  });
});

afterEach(async () => {
  await cleanup();
  await runtime?.liveWalk.tracker.stop();
  runtime?.dispose();
  runtime = undefined;
  c.driver.close();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('R4.14 09 section 6.2 the live route keeps recording on back and finishes through the runtime to walk detail', async () => {
  const app = runtime;
  if (app === undefined) throw new Error('The runtime was not initialized');
  const walk = await app.liveWalk.tracker.start(c.pet.id);
  app.liveWalk.points.append(walk.id, { lat: -23.55, lon: -46.63, acc: 4, t: c.clock.now(), paused: false });
  c.clock.advance(60_000);
  app.liveWalk.points.append(walk.id, { lat: -23.549, lon: -46.63, acc: 4, t: c.clock.now(), paused: false });
  const view = await render(<AppProvider runtime={app}><LiveWalk /></AppProvider>);
  await view.unmount();
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(c.walks.getLocal()?.id).toBe(walk.id);
  await render(<AppProvider runtime={app}><LiveWalk /></AppProvider>);
  await fireEvent.press(screen.getByTestId('walk-finish'));
  await fireEvent.press(screen.getByTestId('walk-finish-confirm'));
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenCalledWith({ pathname: '/walk/[id]', params: { id: walk.id } });
  expect(c.outbox.count()).toBe(2);
  expect(c.walks.getRoute(walk.id)).toHaveLength(2);
  expect(c.walks.getLocal()).toBeNull();
});

test('R4.18 09 section 6.2 the live route discards through the runtime and returns to walks', async () => {
  const app = runtime;
  if (app === undefined) throw new Error('The runtime was not initialized');
  await app.liveWalk.tracker.start(c.pet.id);
  await render(<AppProvider runtime={app}><LiveWalk /></AppProvider>);
  await fireEvent.press(screen.getByTestId('walk-finish'));
  await fireEvent.press(screen.getByTestId('walk-discard'));
  expect(navigation.replace).toHaveBeenCalledWith('/(tabs)/walks');
  expect(c.outbox.count()).toBe(2);
  expect(c.walks.getLocal()).toBeNull();
});
