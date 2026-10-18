import { useRef, type ReactElement } from 'react';
import { ExpoRoot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import RootLayout from '../app/_layout';
import AuthLayout from '../app/(auth)/_layout';
import Login from '../app/(auth)/login';
import TabsLayout from '../app/(tabs)/_layout';
import Dashboard from '../app/(tabs)/index';
import Pets from '../app/(tabs)/pets';
import Walks from '../app/(tabs)/walks';
import Settings from '../app/(tabs)/settings';
import type { AppDependencies } from '../src/bootstrap';
import { useApp, type AppContext } from '../src/appContext';
import { wireSession, servers, epoch } from '../src/auth/__tests__/support';
import { Kv, serverKey } from '../src/db/kv';
import { openDatabase } from '../src/db/open';
import { OutboxRepo } from '../src/db/outboxRepo';
import { ReplicaRepo } from '../src/db/replicaRepo';
import { strings } from '../src/i18n/strings';
import { hydrate } from '../src/replica/hydrate';
import { fakeClock } from '../src/testing/fakeClock';
import { fakeFileSystem } from '../src/testing/fakeFileSystem';
import { fakeHttp } from '../src/testing/fakeHttp';
import { fakeLogFiles } from '../src/testing/fakeLogFiles';
import { fakeRandom } from '../src/testing/fakeRandom';
import { fakeSecretBox } from '../src/testing/fakeSecretBox';
import { fakeWebSocket } from '../src/testing/fakeWebSocket';
import { memoryDriver, type MemoryDriver } from '../src/testing/memoryDriver';
import { rowFactories } from '../src/testing/rowFactories';
import { sequentialIds } from '../src/testing/sequentialIds';
import * as ReduceMotion from '../src/ui/motion/useReduceMotion';

jest.mock('expo-splash-screen', () => ({
  ...jest.requireActual<typeof import('expo-splash-screen')>('expo-splash-screen'),
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => {}),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: jest.fn() },
  NetInfoStateType: { other: 'other' },
}));

const initialAppState = AppState.currentState;
let driver: MemoryDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  // Pawlaris targets Android; the navigator uses button semantics on iOS.
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'select').mockImplementation((options) => options.android ?? options.native
    ?? ('default' in options ? options.default : undefined));
  jest.useFakeTimers({ now: epoch });
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    listener({ type: NetInfoStateType.other, isConnected: true, isInternetReachable: true,
      details: { isConnectionExpensive: false } });
    return () => {};
  });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  driver = await memoryDriver();
});

afterEach(async () => {
  await cleanup();
  driver.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

function dependencies() {
  const clock = fakeClock(epoch);
  const ids = sequentialIds();
  const http = fakeHttp();
  const secretBox = fakeSecretBox();
  const socket = fakeWebSocket();
  const deps = {
    driver, clock, ids, http, secretBox, servers,
    random: fakeRandom(...Array.from({ length: 20 }, () => 0.5)),
    fileSystem: fakeFileSystem(), logFiles: fakeLogFiles(), documentDirectory: 'file:///fake/documents/',
    perfOutput: jest.fn(), WebSocketImpl: socket.WebSocketImpl, online: true,
  } satisfies AppDependencies;
  return { deps, http, secretBox, socket, kv: new Kv(driver), factory: rowFactories(clock, ids) };
}

async function renderShell(deps: AppDependencies, observeDashboard?: (app: AppContext) => void) {
  function DashboardRoute() {
    const app = useApp();
    const observed = useRef(false);
    if (!observed.current) {
      observed.current = true;
      observeDashboard?.(app);
    }
    return <Dashboard />;
  }
  const routes: Record<string, { default: () => ReactElement }> = {
    './_layout.tsx': { default: () => <RootLayout dependencies={deps} /> },
    './(auth)/_layout.tsx': { default: AuthLayout },
    './(auth)/login.tsx': { default: Login },
    './(tabs)/_layout.tsx': { default: TabsLayout },
    './(tabs)/index.tsx': { default: DashboardRoute },
    './(tabs)/pets.tsx': { default: Pets },
    './(tabs)/walks.tsx': { default: Walks },
    './(tabs)/settings.tsx': { default: Settings },
  };
  function requireRoute<T>(key: string): T {
    const route = routes[key];
    if (route === undefined) throw new Error(`Missing test route ${key}`);
    return route as T;
  }
  const context = Object.assign(requireRoute, {
    keys: () => Object.keys(routes), resolve: (key: string) => key, id: 'shell-test-routes',
  });
  return render(<ExpoRoot context={context} location="/" />);
}

test('R5.1 startup without session renders the login placeholder without HTTP', async () => {
  const c = dependencies();
  await renderShell(c.deps);
  expect(screen.getByTestId('login-placeholder')).toBeOnTheScreen();
  expect(screen.getByText(strings.appName)).toBeOnTheScreen();
  expect(screen.queryByTestId('dashboard-placeholder')).toBeNull();
  expect(c.http.requests).toHaveLength(0);
  expect(c.socket.instances).toHaveLength(0);
});

test('R5.1 startup with a session paints the replica and four tabs before any HTTP', async () => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const pet = c.factory.pets();
  const replica = new ReplicaRepo(driver);
  replica.upsert('family', c.factory.family(), { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('pets', pet, { pending: false, deleted: false, pullGen: 0 });
  c.http.enqueue(() => {
    expect(screen.getByTestId('dashboard-placeholder')).toBeOnTheScreen();
    return new Promise(() => {});
  });
  const hide = jest.spyOn(SplashScreen, 'hideAsync').mockResolvedValue(undefined);
  const observeDashboard = jest.fn((app: AppContext) => {
    expect(app.db).toBe(driver);
    expect(app.store.getState().ready).toBe(true);
    expect(app.store.getState().pets[pet.id]).toEqual(pet);
    expect(c.http.requests).toHaveLength(0);
  });
  await renderShell(c.deps, observeDashboard);
  const dashboard = screen.getByTestId('dashboard-placeholder');
  expect(observeDashboard).toHaveBeenCalledTimes(1);
  expect(dashboard).toBeOnTheScreen();
  for (const label of Object.values(strings.tabs)) {
    expect(screen.getByRole('tab', { name: label })).toBeOnTheScreen();
  }
  expect(screen.queryByTestId('login-placeholder')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(c.http.requests).toHaveLength(0);
  expect(c.socket.instances).toHaveLength(0);
  expect(hide).not.toHaveBeenCalled();
  await fireEvent(dashboard, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } },
  });
  await act(async () => { await Promise.resolve(); });
  expect(hide).toHaveBeenCalledTimes(1);
  expect(c.http.requests.length).toBeGreaterThan(0);
  expect(replica.get('pets', pet.id)?.row).toEqual(pet);
});

test('P4-3 dashboard marker ignores skeleton layouts and emits once after family hydration', async () => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  c.http.enqueue(() => new Promise(() => {}));
  const observeDashboard = jest.fn((app: AppContext) => {
    expect(app.sessionUser()).toEqual(wire.user);
    expect(app.store.getState()).toMatchObject({ ready: true, family: null });
  });
  await renderShell(c.deps, observeDashboard);
  const app = observeDashboard.mock.calls[0]?.[0];
  if (app === undefined) throw new Error('Dashboard did not render');
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } } };
  const dashboard = screen.getByTestId('dashboard-placeholder');
  expect(dashboard.queryAll((node) => node.props.importantForAccessibility === 'no-hide-descendants')).toHaveLength(5);
  expect(c.deps.perfOutput).not.toHaveBeenCalled();
  await fireEvent(dashboard, 'layout', layout);
  await fireEvent(dashboard, 'layout', layout);
  expect(c.deps.perfOutput).not.toHaveBeenCalled();

  const family = c.factory.family({ id: wire.user.family_id });
  await act(() => {
    new ReplicaRepo(driver).upsert('family', family, { pending: false, deleted: false, pullGen: 0 });
    hydrate({ driver, store: app.store, clock: c.deps.clock });
  });
  expect(app.store.getState().family).toEqual(family);
  const hydratedDashboard = screen.getByTestId('dashboard-placeholder');
  expect(hydratedDashboard.queryAll((node) => node.props.importantForAccessibility === 'no-hide-descendants')).toHaveLength(0);
  expect(c.deps.perfOutput).not.toHaveBeenCalled();
  await fireEvent(hydratedDashboard, 'layout', layout);
  expect(c.deps.perfOutput).toHaveBeenCalledTimes(1);
  expect(c.deps.perfOutput).toHaveBeenCalledWith('PAWLARIS_PERF dashboard_interactive');
  await fireEvent(hydratedDashboard, 'layout', layout);
  await fireEvent(hydratedDashboard, 'layout', layout);
  expect(c.deps.perfOutput).toHaveBeenCalledTimes(1);
});

test.each(['primary', 'reserve'] as const)('SE-2 signed_out on %s survives restart and keeps replica and outbox', async (server) => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession(server);
  c.kv.set('session_user', JSON.stringify(wire.user));
  c.kv.set('active_server', server);
  c.kv.set(serverKey('signed_out', server), '1');
  await c.secretBox.set(`session_tokens.${server}`, JSON.stringify(wire));
  const pet = c.factory.pets({ revision: null });
  const replica = new ReplicaRepo(driver);
  const outbox = new OutboxRepo(driver);
  replica.upsert('pets', pet, { pending: true, deleted: false, pullGen: 0 });
  outbox.insert(c.factory.outbox({ userId: wire.user.id, entityId: pet.id }));
  const beforeRows = driver.all('SELECT * FROM replica');
  const beforeOutbox = driver.all('SELECT * FROM outbox');
  const first = await renderShell(c.deps);
  expect(screen.getByTestId('login-placeholder')).toBeOnTheScreen();
  expect(screen.queryByTestId('dashboard-placeholder')).toBeNull();
  expect(driver.all('SELECT * FROM replica')).toEqual(beforeRows);
  expect(driver.all('SELECT * FROM outbox')).toEqual(beforeOutbox);
  await first.unmount();
  await renderShell(c.deps);
  expect(screen.getByTestId('login-placeholder')).toBeOnTheScreen();
  expect(driver.all('SELECT * FROM replica')).toEqual(beforeRows);
  expect(driver.all('SELECT * FROM outbox')).toEqual(beforeOutbox);
  expect(c.http.requests).toHaveLength(0);
});
