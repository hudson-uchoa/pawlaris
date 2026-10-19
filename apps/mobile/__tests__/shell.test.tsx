import { useRef, type ReactElement } from 'react';
import { ExpoRoot, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, BackHandler, Platform } from 'react-native';
import { measure } from 'react-native-reanimated';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import RootLayout from '../app/_layout';
import AuthLayout from '../app/(auth)/_layout';
import Login from '../app/(auth)/login';
import Redeem from '../app/(auth)/redeem';
import TabsLayout from '../app/(tabs)/_layout';
import Dashboard from '../app/(tabs)/index';
import Pets from '../app/(tabs)/pets';
import Walks from '../app/(tabs)/walks';
import Settings from '../app/(tabs)/settings';
import NewPet from '../app/pet/new';
import EditPet from '../app/pet/[id]/edit';
import PetProfile from '../app/pet/[id]/index';
import PetWeight from '../app/pet/[id]/weight';
import NewHealthEvent from '../app/pet/[id]/health/new';
import HealthDetail from '../app/health/[id]';
import CameraRoute from '../app/camera';
import FamilyRoute from '../app/settings/family';
import DiagnosticsRoute from '../app/settings/diagnostics';
import PermissionsRoute from '../app/settings/permissions';
import PasswordRoute from '../app/settings/password';
import TasksRoute from '../app/tasks/index';
import NewTaskRoute from '../app/task/new';
import EditTaskRoute from '../app/task/[id]/edit';
import type { AppDependencies } from '../src/bootstrap';
import { useApp, type AppContext } from '../src/appContext';
import { wireSession, servers, epoch, response } from '../src/auth/__tests__/support';
import { Kv, serverKey } from '../src/db/kv';
import { openDatabase } from '../src/db/open';
import { OutboxRepo } from '../src/db/outboxRepo';
import { ReplicaRepo } from '../src/db/replicaRepo';
import { strings } from '../src/i18n/strings';
import { hydrate } from '../src/replica/hydrate';
import { fakeClock } from '../src/testing/fakeClock';
import { fakeCamera } from '../src/testing/fakeCamera';
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
import { duration } from '../src/ui/motion/tokens';

jest.mock('react-native-reanimated', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native-reanimated')),
  measure: { value: jest.fn(), configurable: true, enumerable: true },
}));

type AnimationAPI = typeof import('react-native-reanimated');
type ThreadsAPI = typeof import('react-native-worklets');
const threadsEntry = jest.requireActual<{ main: string }>('react-native-worklets/package.json').main;
const threadsRoot = `react-native-worklets/${threadsEntry.replace(/\/index(?:\.js)?$/, '')}`;
const threads = jest.requireActual<Pick<ThreadsAPI, 'scheduleOnUI' | 'scheduleOnRN'>>(`${threadsRoot}/threads`);
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);

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
  // Deliver native thread handoffs synchronously; retain the real animation driver.
  jest.spyOn(threads, 'scheduleOnUI').mockImplementation((worklet, ...args) => { worklet(...args); });
  jest.spyOn(threads, 'scheduleOnRN').mockImplementation((callback, ...args) => { callback(...args); });
  jest.mocked(measure).mockReset().mockReturnValue(null);
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
  const fileSystem = fakeFileSystem();
  const camera = fakeCamera(fileSystem);
  const deps = {
    driver, clock, ids, http, secretBox, servers,
    random: fakeRandom(...Array.from({ length: 20 }, () => 0.5)),
    fileSystem, camera: camera.device, logFiles: fakeLogFiles(), documentDirectory: 'file:///fake/documents/',
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
    './(auth)/redeem.tsx': { default: Redeem },
    './(tabs)/_layout.tsx': { default: TabsLayout },
    './(tabs)/index.tsx': { default: DashboardRoute },
    './(tabs)/pets.tsx': { default: Pets },
    './(tabs)/walks.tsx': { default: Walks },
    './(tabs)/settings.tsx': { default: Settings },
    './pet/new.tsx': { default: NewPet },
    './pet/[id]/edit.tsx': { default: EditPet },
    './pet/[id]/index.tsx': { default: PetProfile },
    './pet/[id]/weight.tsx': { default: PetWeight },
    './pet/[id]/health/new.tsx': { default: NewHealthEvent },
    './health/[id].tsx': { default: HealthDetail },
    './camera.tsx': { default: CameraRoute },
    './settings/family.tsx': { default: FamilyRoute },
    './settings/diagnostics.tsx': { default: DiagnosticsRoute },
    './settings/permissions.tsx': { default: PermissionsRoute },
    './settings/password.tsx': { default: PasswordRoute },
    './tasks/index.tsx': { default: TasksRoute },
    './task/new.tsx': { default: NewTaskRoute },
    './task/[id]/edit.tsx': { default: EditTaskRoute },
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

test('P5-1 the task list route opens the edit form until task detail exists', async () => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const replica = new ReplicaRepo(driver);
  const pet = c.factory.pets();
  const task = c.factory.task_templates({ pet_ids: [pet.id], created_by: wire.user.id });
  replica.upsert('family', c.factory.family({ id: wire.user.family_id }), { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('members', c.factory.members({ id: wire.user.id }), { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('pets', pet, { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('task_templates', task, { pending: false, deleted: false, pullGen: 0 });
  await renderShell(c.deps);
  await act(() => { router.push('./tasks'); });
  expect(screen.getByRole('radio', { name: strings.tasks.active })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: task.title }));
  expect(screen.getByTestId('task-title')).toHaveDisplayValue(task.title);
  expect(screen.getByTestId('task-end')).toBeOnTheScreen();
  expect(c.http.requests).toEqual([]);
});

test('P4-9 Settings routes open family, password, permissions and the wired diagnostics', async () => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const replica = new ReplicaRepo(driver);
  const family = c.factory.family({ id: wire.user.family_id });
  replica.upsert('family', family, { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('members', c.factory.members({ id: wire.user.id }), { pending: false, deleted: false, pullGen: 0 });
  const observe = jest.fn((_app: AppContext) => {});
  await renderShell(c.deps, observe);
  await fireEvent.press(screen.getByRole('tab', { name: strings.tabs.settings }));
  await fireEvent.press(screen.getByTestId('settings-family'));
  expect(screen.getByTestId('family-name')).toHaveDisplayValue(family.name);
  expect(screen.getByTestId('member-name-edit')).toBeOnTheScreen();
  await act(() => { router.back(); });
  expect(c.http.requests).toEqual([]);
  const app = observe.mock.calls[0]?.[0];
  if (app === undefined) throw new Error('The shell runtime was not observed');
  c.http.enqueue(() => new Promise(() => {}));
  await act(() => { app.engine.setOnline(true); });
  await fireEvent.press(screen.getByTestId('settings-password'));
  expect(screen.getByTestId('password-current')).toBeOnTheScreen();
  await act(() => { router.back(); });
  await fireEvent.press(screen.getByTestId('settings-permissions'));
  expect(screen.getByTestId('permissions-list')).toBeOnTheScreen();
  await act(() => { router.back(); });
  c.http.enqueue(response(200, { status: 'ok', role: 'primary' }));
  await fireEvent.press(screen.getByTestId('settings-diagnostics'));
  expect(screen.getByTestId('diag-revision')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('diag-selftest'));
  expect(screen.getByTestId('diag-selftest-result')).toBeOnTheScreen();
  expect(c.http.requests).toHaveLength(2);
  expect(c.http.requests.at(-1)?.url).toBe(`${servers.primary}/health`);
});

test('R5.1 startup without session renders the login placeholder without HTTP', async () => {
  const c = dependencies();
  await renderShell(c.deps);
  expect(screen.getByTestId('login-placeholder')).toBeOnTheScreen();
  expect(screen.getByText(strings.appName)).toBeOnTheScreen();
  expect(screen.queryByTestId('dashboard-placeholder')).toBeNull();
  expect(c.http.requests).toHaveLength(0);
  expect(c.socket.instances).toHaveLength(0);
});

test('P4-4 R1.5 offline login stays enabled and shows the network error', async () => {
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    listener({ type: NetInfoStateType.other, isConnected: false, isInternetReachable: false,
      details: { isConnectionExpensive: false } });
    return () => {};
  });
  const c = dependencies();
  await renderShell(c.deps);
  await fireEvent(screen.getByTestId('login-placeholder'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } },
  });
  expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('login-submit')).not.toBeDisabled();
  c.http.enqueue(new Error('Simulated offline transport'));
  await fireEvent.changeText(screen.getByTestId('login-email'), wireSession('primary').user.email);
  await fireEvent.changeText(screen.getByTestId('login-password'), 'test-only-password');
  await fireEvent.press(screen.getByTestId('login-submit'));
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]).toMatchObject({ method: 'POST', url: `${servers.primary}/auth/login` });
  expect(screen.getByRole('alert')).toHaveTextContent(strings.auth.networkError);
});

test('P4-4 login layout hides the splash once and invite navigation returns on back', async () => {
  const c = dependencies();
  await renderShell(c.deps);
  expect(screen.getByTestId('login-submit')).toBeOnTheScreen();
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } } };
  await fireEvent(screen.getByTestId('login-placeholder'), 'layout', layout);
  await fireEvent(screen.getByTestId('login-placeholder'), 'layout', layout);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('login-to-redeem'));
  expect(screen.getByTestId('redeem-submit')).toBeOnTheScreen();
  expect(c.http.requests).toHaveLength(0);
  await act(() => { router.back(); });
  expect(screen.getByTestId('login-submit')).toBeOnTheScreen();
  expect(c.http.requests).toHaveLength(0);
});

test.each(['login', 'redeem'] as const)('P4-4 %s route adopts the session and opens skeleton tabs during arrival', async (route) => {
  const c = dependencies();
  await renderShell(c.deps);
  await fireEvent(screen.getByTestId('login-placeholder'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } },
  });
  if (route === 'redeem') {
    await fireEvent.press(screen.getByTestId('login-to-redeem'));
    await fireEvent.changeText(screen.getByTestId('redeem-code'), '7K2M9QX4TB');
    await fireEvent.changeText(screen.getByTestId('redeem-name'), 'Test member');
  }
  const wire = wireSession('primary', route);
  c.http.enqueue(response(200, wire), () => new Promise(() => {}));
  await fireEvent.changeText(screen.getByTestId(`${route}-email`), wire.user.email);
  await fireEvent.changeText(screen.getByTestId(`${route}-password`), 'test-only-password');
  await fireEvent.press(screen.getByTestId(`${route}-submit`));
  expect(JSON.parse(c.kv.get('session_user') ?? 'null')).toEqual(wire.user);
  expect(screen.getByTestId('dashboard-placeholder')).toBeOnTheScreen();
  expect(screen.queryByTestId('login-submit')).toBeNull();
  expect(screen.queryByTestId('redeem-submit')).toBeNull();
  expect(c.http.requests.map(({ url }) => url)).toEqual([
    `${servers.primary}/auth/${route}`, `${servers.primary}/sync?since=0&limit=1`,
  ]);
  for (const label of Object.values(strings.tabs)) {
    expect(screen.getByRole('tab', { name: label })).toBeOnTheScreen();
  }
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
  await fireEvent.press(screen.getByRole('tab', { name: strings.tabs.pets }));
  expect(screen.getByTestId(`pet-card-${pet.id}`)).toHaveTextContent(pet.name);
  expect(screen.getByTestId('pet-add')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('pet-add'));
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await fireEvent.press(screen.getByRole('radio', { name: strings.pets.dog }));
  c.deps.fileSystem.enqueue(() => new Promise(() => {}));
  await fireEvent.press(screen.getByTestId('pet-avatar'));
  expect(screen.getByTestId('camera-shutter')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: strings.camera.gallery }));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(screen.getByTestId('pet-name')).toHaveDisplayValue('Vega');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(screen.getByTestId('pet-add')).toBeOnTheScreen();
  const created = new OutboxRepo(driver).head(wire.user.id);
  expect(replica.get('pets', created?.entityId ?? '')?.row.name).toBe('Vega');
  expect(replica.get('pets', created?.entityId ?? '')?.row.avatar_asset_id).toBeTruthy();
  await act(() => { router.push({ pathname: '../pet/[id]/edit', params: { id: pet.id } }); });
  expect(screen.getByTestId('pet-name')).toHaveDisplayValue(pet.name);
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Atlas');
  c.deps.fileSystem.enqueue(() => new Promise(() => {}));
  await fireEvent.press(screen.getByTestId('pet-avatar'));
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(screen.getByTestId('pet-name')).toHaveDisplayValue('Atlas');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(screen.getByTestId(`pet-card-${pet.id}`)).toHaveTextContent('Atlas');
  expect(replica.get('pets', pet.id)?.row.avatar_asset_id).toBeTruthy();
});

test('P4-6 pet routes save a weight with a toast, edit the pet and return to walks without HTTP', async () => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const pet = c.factory.pets({ species: 'dog' });
  const replica = new ReplicaRepo(driver);
  replica.upsert('family', c.factory.family({ id: wire.user.family_id }), { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('pets', pet, { pending: false, deleted: false, pullGen: 0 });
  await renderShell(c.deps);
  await fireEvent.press(screen.getByRole('tab', { name: strings.tabs.pets }));
  await fireEvent.press(screen.getByTestId(`pet-card-${pet.id}`));
  expect(screen.getByTestId('pet-profile')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('weight-add'));
  expect(screen.getByTestId('weight-value')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,25');
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(screen.queryByTestId('weight-save')).toBeNull();
  expect(screen.getByTestId('weight-latest')).toHaveTextContent(strings.weights.kilograms('4,25'));
  expect(screen.getByRole('alert', { name: strings.toasts.weightRecorded })).toBeOnTheScreen();
  expect(new OutboxRepo(driver).head(wire.user.id)).toMatchObject({
    method: 'POST', path: '/weights', body: { pet_id: pet.id, weight_kg: 4.25 },
  });
  await fireEvent.press(screen.getByTestId('pet-edit'));
  expect(screen.getByTestId('pet-name')).toHaveDisplayValue(pet.name);
  await act(() => { router.back(); });
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.viewAll }));
  expect(screen.getByTestId('walks-placeholder')).toBeOnTheScreen();
  expect(c.http.requests).toEqual([]);
});

test('P4-8 card release overlays the profile, settles its header, then system back restores the source', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  const backHandlers = new Set<Parameters<typeof BackHandler.addEventListener>[1]>();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandlers.add(handler);
    return { remove: () => { backHandlers.delete(handler); } };
  });
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const pet = c.factory.pets();
  const replica = new ReplicaRepo(driver);
  replica.upsert('family', c.factory.family({ id: wire.user.family_id }), { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('pets', pet, { pending: false, deleted: false, pullGen: 0 });
  await renderShell(c.deps);
  await fireEvent.press(screen.getByRole('tab', { name: strings.tabs.pets }));
  const frame = (pageX: number, pageY: number, width: number, height: number) => ({ x: 0, y: 0, pageX, pageY, width, height });
  const sourceAvatar = frame(20, 80, 48, 48);
  const sourceName = frame(30, 150, 80, 24);
  const targetAvatar = frame(100, 60, 96, 96);
  const targetName = frame(110, 190, 120, 36);
  jest.mocked(measure).mockReturnValueOnce(sourceAvatar).mockReturnValueOnce(sourceName)
    .mockReturnValueOnce(targetAvatar).mockReturnValueOnce(targetName);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const card = screen.getByTestId(`pet-card-${pet.id}`);
  await fireEvent(card, 'pressIn');
  expect(screen.queryByTestId('pet-profile')).toBeNull();
  await fireEvent(card, 'pressOut');
  await fireEvent.press(card);
  expect(screen.getByTestId('hero-overlay', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByTestId(`pet-source-avatar-${pet.id}`, { includeHiddenElements: true })).toHaveAnimatedStyle({ opacity: 0 });
  const avatar = screen.getByTestId(`pet-target-avatar-${pet.id}`, { includeHiddenElements: true });
  const name = screen.getByTestId(`pet-target-name-${pet.id}`, { includeHiddenElements: true });
  expect(avatar).toHaveAnimatedStyle({ opacity: 0 });
  expect(name).toHaveAnimatedStyle({ opacity: 0 });
  expect(screen.queryByTestId(`pet-orbit-${pet.id}-satellite`, { includeHiddenElements: true })).toBeNull();
  await fireEvent(avatar, 'layout');
  await fireEvent(name, 'layout');
  expect(timing.mock.calls.some(([value, config]) => value === 1 && config?.duration === duration.base)).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(duration.base + 32); });
  expect(screen.getByTestId('pet-profile')).toHaveAnimatedStyle({ opacity: 1 });
  // The body has appeared while the header copies still own the hero.
  expect(screen.getByTestId('hero-overlay', { includeHiddenElements: true })).toBeOnTheScreen();
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(avatar).toHaveAnimatedStyle({ opacity: 1 });
  expect(name).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId(`pet-orbit-${pet.id}-satellite`, { includeHiddenElements: true })).toBeOnTheScreen();

  jest.mocked(measure).mockReturnValueOnce(targetAvatar).mockReturnValueOnce(targetName)
    .mockReturnValueOnce(sourceAvatar).mockReturnValueOnce(sourceName);
  await act(() => {
    const handled = [...backHandlers].reverse().some((handler) => handler({ type: 'hardwareBackPress', timeStamp: epoch }));
    expect(handled).toBe(true);
  });
  expect(screen.getByTestId('hero-overlay', { includeHiddenElements: true })).toBeOnTheScreen();
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(screen.queryByTestId('pet-profile')).toBeNull();
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId(`pet-source-avatar-${pet.id}`)).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId(`pet-source-name-${pet.id}`)).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId(`pet-card-${pet.id}`)).toBeOnTheScreen();
  expect(c.http.requests).toEqual([]);
});

test('P4-7 R2.10 health routes preserve drafts through attachment capture, edit and confirmed deletion', async () => {
  openDatabase(driver);
  const c = dependencies();
  const wire = wireSession('primary');
  c.kv.set('session_user', JSON.stringify(wire.user));
  await c.secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const pet = c.factory.pets();
  const replica = new ReplicaRepo(driver);
  replica.upsert('family', c.factory.family({ id: wire.user.family_id }), { pending: false, deleted: false, pullGen: 0 });
  replica.upsert('pets', pet, { pending: false, deleted: false, pullGen: 0 });
  await renderShell(c.deps);
  await fireEvent.press(screen.getByRole('tab', { name: strings.tabs.pets }));
  await fireEvent.press(screen.getByTestId(`pet-card-${pet.id}`));
  await fireEvent.press(screen.getByTestId('health-add'));
  await fireEvent.press(screen.getByRole('radio', { name: strings.health.types.vaccine }));
  await fireEvent.changeText(screen.getByTestId('health-title'), 'Vaccine visit');
  await fireEvent.changeText(screen.getByTestId('health-next-due-on'), '12/11/2026');
  await fireEvent.changeText(screen.getByTestId('health-notes'), 'Bring previous results');
  c.deps.fileSystem.enqueue(() => new Promise(() => {}));
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.photo }));
  expect(screen.queryByRole('button', { name: strings.camera.gallery })).toBeNull();
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(screen.getByTestId('health-title')).toHaveDisplayValue('Vaccine visit');
  expect(screen.getByTestId('health-notes')).toHaveDisplayValue('Bring previous results');
  expect(screen.getByTestId('health-next-due-on')).toHaveDisplayValue('12/11/2026');
  expect(screen.getByRole('radio', { name: strings.health.types.vaccine })).toBeChecked();
  expect(driver.all('SELECT kind FROM asset_file')).toEqual([{ kind: 'health_attachment' }]);
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(screen.getByTestId('pet-profile')).toBeOnTheScreen();
  const created = new OutboxRepo(driver).head(wire.user.id);
  if (created === null) throw new Error('The health event was not queued');
  const event = replica.get('health_events', created.entityId)?.row;
  if (event === undefined) throw new Error('The health event is missing from the replica');
  expect(created).toMatchObject({ method: 'POST', path: '/health-events', body: {
    pet_id: pet.id, type: 'vaccine', title: 'Vaccine visit', next_due_on: '2026-11-12',
    notes: 'Bring previous results', attachment_asset_id: event.attachment_asset_id,
  } });
  expect(event.attachment_asset_id).not.toBeNull();
  await fireEvent.press(screen.getByTestId(`health-event-${event.id}`));
  await fireEvent.changeText(screen.getByTestId('health-title'), 'Follow-up visit');
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.photo }));
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(screen.getByTestId('health-title')).toHaveDisplayValue('Follow-up visit');
  await fireEvent.press(screen.getByTestId('health-save'));
  const edited = replica.get('health_events', event.id)?.row;
  expect(edited?.title).toBe('Follow-up visit');
  expect(edited?.attachment_asset_id).not.toBe(event.attachment_asset_id);
  expect(new OutboxRepo(driver).count()).toBe(2);
  await fireEvent.press(screen.getByTestId(`health-event-${event.id}`));
  await fireEvent.press(screen.getByTestId('health-delete'));
  await fireEvent.press(screen.getByRole('button', { name: strings.dismiss }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  expect(replica.get('health_events', event.id)?.row.title).toBe('Follow-up visit');
  expect(new OutboxRepo(driver).count()).toBe(2);
  await fireEvent.press(screen.getByTestId('health-delete'));
  await fireEvent.press(screen.getByTestId('health-delete-confirm'));
  expect(screen.getByTestId('pet-profile')).toBeOnTheScreen();
  expect(screen.queryByTestId(`health-event-${event.id}`)).toBeNull();
  expect(replica.get('health_events', event.id)).toBeNull();
  expect(new OutboxRepo(driver).count()).toBe(3);
  expect(c.http.requests).toEqual([]);
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
