import { fakeNotifications } from '../src/testing/fakeNotifications';
import { cleanup, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { AppProvider } from '../src/appContext';
import { createAppRuntime, type AppRuntime } from '../src/bootstrap';
import { epoch, servers } from '../src/auth/__tests__/support';
import { fakeClock } from '../src/testing/fakeClock';
import { fakeFileSystem } from '../src/testing/fakeFileSystem';
import { fakeHttp } from '../src/testing/fakeHttp';
import { fakeLogFiles } from '../src/testing/fakeLogFiles';
import { fakeRandom } from '../src/testing/fakeRandom';
import { fakeSecretBox } from '../src/testing/fakeSecretBox';
import { fakeWebSocket } from '../src/testing/fakeWebSocket';
import { memoryDriver, type MemoryDriver } from '../src/testing/memoryDriver';
import { sequentialIds } from '../src/testing/sequentialIds';

import Index from '../app/(auth)/login';

// The shell replaces the scratch route; keep the original name invariant.
jest.mock('expo-router', () => ({ useIsFocused: () => true, useRouter: () => ({ push: jest.fn() }) }));
const initialAppState = AppState.currentState;
let driver: MemoryDriver;
let runtime: AppRuntime;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  driver = await memoryDriver();
  runtime = createAppRuntime({ driver, clock: fakeClock(epoch), ids: sequentialIds(),
    notifications: fakeNotifications().platform, http: fakeHttp(), secretBox: fakeSecretBox(), servers, random: fakeRandom(0.5),
    fileSystem: fakeFileSystem(), documentDirectory: 'file:///fake/documents/', logFiles: fakeLogFiles(),
    WebSocketImpl: fakeWebSocket().WebSocketImpl, online: true });
});

afterEach(async () => {
  await cleanup();
  runtime.dispose();
  driver.close();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

it('P0-5 renders the Pawlaris name', async () => {
  await render(<AppProvider runtime={runtime}><Index /></AppProvider>);

  expect(screen.getByText('Pawlaris')).toBeOnTheScreen();
});
