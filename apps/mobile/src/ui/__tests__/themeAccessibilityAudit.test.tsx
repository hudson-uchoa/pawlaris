import { cleanup, render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AppState, Dimensions, PixelRatio, useColorScheme } from 'react-native';
import { AssetFilesProvider } from '../../assets/useAssetFile';
import { authContext } from '../../features/auth/__tests__/support';
import { LoginScreen } from '../../features/auth/LoginScreen';
import { RedeemScreen } from '../../features/auth/RedeemScreen';
import { dashboardContext } from '../../features/dashboard/__tests__/support';
import { DashboardScreen } from '../../features/dashboard/DashboardScreen';
import { PhotoProofCameraScreen } from '../../features/dashboard/PhotoProofCameraScreen';
import { FamilyScreen } from '../../features/family/FamilyScreen';
import { HealthDetailScreen } from '../../features/health/HealthDetailScreen';
import { HealthFormScreen } from '../../features/health/HealthFormScreen';
import { NotificationsScreen } from '../../features/permission/NotificationsScreen';
import { petContext } from '../../features/pets/__tests__/support';
import { CameraScreen } from '../../features/pets/CameraScreen';
import { createPhotoCapture } from '../../features/pets/capture';
import { PetFormScreen } from '../../features/pets/PetFormScreen';
import { PetProfileScreen } from '../../features/pets/PetProfileScreen';
import { PetsGridScreen } from '../../features/pets/PetsGridScreen';
import { WeightFormScreen } from '../../features/pets/WeightFormScreen';
import { settingsContext } from '../../features/settings/__tests__/support';
import { DiagnosticsScreen } from '../../features/settings/DiagnosticsScreen';
import { PasswordScreen } from '../../features/settings/PasswordScreen';
import { PermissionsScreen } from '../../features/settings/PermissionsScreen';
import { SettingsScreen } from '../../features/settings/SettingsScreen';
import { taskContext } from '../../features/tasks/__tests__/support';
import { TaskDetailScreen } from '../../features/tasks/TaskDetailScreen';
import { TaskFormScreen } from '../../features/tasks/TaskFormScreen';
import { TasksListScreen } from '../../features/tasks/TasksListScreen';
import { liveContext, resetLivePlatform } from '../../features/walks/__tests__/liveSupport';
import { LiveWalkScreen } from '../../features/walks/LiveWalkScreen';
import { LocationPermissionScreen } from '../../features/walks/LocationPermissionScreen';
import { WalkDetailScreen } from '../../features/walks/WalkDetailScreen';
import { WalksScreen } from '../../features/walks/WalksScreen';
import { createNotificationPermission } from '../../notifications/permission';
import { ReplicaProvider } from '../../replica/useReplica';
import { fakeCamera } from '../../testing/fakeCamera';
import { fakeNotifications } from '../../testing/fakeNotifications';
import { historyContext } from '../../walks/__tests__/historySupport';
import type { LocationPermissions } from '../../walks/permissions';
import { HeroProvider } from '../motion/hero';
import * as ReduceMotion from '../motion/useReduceMotion';
import { accessibilityProblems, cards, nodes, pressables, targetProblems, themeProblems } from './themeAccessibilitySupport';

type Scene = { element: ReactElement; dispose(): void | Promise<void>; network?(): unknown[] };
type ScreenCase = { name: string; scene(): Promise<Scene> };
const noop = () => {};
const initialAppState = AppState.currentState;
let current: Scene | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  resetLivePlatform();
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden'));
  const getDimensions = Dimensions.get;
  jest.spyOn(Dimensions, 'get').mockImplementation((key) => ({ ...getDimensions(key), fontScale: 1.3 }));
});

afterEach(async () => {
  await cleanup();
  const requests = current?.network?.();
  await current?.dispose();
  current = undefined;
  expect(requests ?? []).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

const authCases: ScreenCase[] = ['LoginScreen', 'RedeemScreen'].map((name) => ({ name, async scene() {
  const c = await authContext();
  return { dispose: c.dispose, network: () => c.http.requests,
    element: <ReplicaProvider store={c.store}>{name === 'LoginScreen'
      ? <LoginScreen services={c.services} active onRedeem={noop} />
      : <RedeemScreen services={c.services} active />}</ReplicaProvider> };
} }));

const petCases: ScreenCase[] = ['PetsGridScreen', 'PetProfileScreen', 'PetFormScreen', 'WeightFormScreen',
  'HealthFormScreen', 'HealthDetailScreen', 'CameraScreen', 'PhotoProofCameraScreen', 'NotificationsScreen']
  .map((name) => ({ name, async scene() {
    const c = await petContext();
    const pet = c.seedPet({ species: 'dog' });
    const event = c.factory.health_events({ pet_id: pet.id });
    c.driver.transaction(() => { c.apply.applyLocalRow('health_events', event); });
    const camera = fakeCamera(c.fileSystem);
    const capture = createPhotoCapture(camera.device, c.files, c.ids);
    const permission = createNotificationPermission({ kv: c.kv, platform: fakeNotifications().platform });
    const elements: Record<string, ReactElement> = {
      PetsGridScreen: <PetsGridScreen services={c.services} active onAdd={noop} onOpenPet={noop} />,
      PetProfileScreen: <PetProfileScreen services={c.services} petId={pet.id} active
        onEdit={noop} onAddWeight={noop} onAddHealth={noop} onOpenHealth={noop} onWalks={noop} />,
      PetFormScreen: <PetFormScreen services={c.services} petId={pet.id} active onClose={noop} onAvatar={noop} />,
      WeightFormScreen: <WeightFormScreen services={c.services} petId={pet.id} active onClose={noop} />,
      HealthFormScreen: <HealthFormScreen services={c} petId={pet.id} active onClose={noop} onAttachment={noop} />,
      HealthDetailScreen: <HealthDetailScreen services={c} eventId={event.id} active onClose={noop} onAttachment={noop} />,
      CameraScreen: <CameraScreen mode="avatar" device={camera.device} capture={capture} active onUse={noop} onCancel={noop} />,
      PhotoProofCameraScreen: <PhotoProofCameraScreen device={camera.device} capture={capture} active
        target={{ taskId: c.factory.taskId, occurrenceKey: '2026-10-13', petId: null }}
        clock={c.clock} mutations={c.mutations} onClose={noop} />,
      NotificationsScreen: <NotificationsScreen permission={permission} active onClose={noop} />,
    };
    const element = elements[name];
    if (element === undefined) throw new Error(`Unknown pet screen ${name}`);
    return { dispose: c.dispose, network: () => c.http.requests,
      element: <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
        <HeroProvider active={false}>{element}</HeroProvider>
      </AssetFilesProvider></ReplicaProvider> };
  } }));

const taskCases: ScreenCase[] = ['TasksListScreen', 'TaskFormScreen', 'TaskDetailScreen'].map((name) => ({ name, async scene() {
  const c = await taskContext();
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], times_of_day: [], recurrence: { freq: 'daily', interval: 1 } });
  const element = name === 'TasksListScreen' ? <TasksListScreen services={c.services} active onOpenTask={noop} />
    : name === 'TaskFormScreen' ? <TaskFormScreen services={c.services} active taskId={task.id} onClose={noop} />
      : <TaskDetailScreen taskId={task.id} services={{ ...c.services, mutations: c.mutations, readCompletionRange: () => [] }} active onEdit={noop} />;
  return { dispose: c.dispose, network: () => c.http.requests,
    element: <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>{element}</AssetFilesProvider></ReplicaProvider> };
} }));

const settingsCases: ScreenCase[] = ['SettingsScreen', 'FamilyScreen', 'PasswordScreen', 'PermissionsScreen', 'DiagnosticsScreen']
  .map((name) => ({ name, async scene() {
    const c = await settingsContext();
    const elements: Record<string, ReactElement> = {
      SettingsScreen: <SettingsScreen services={c.services} active onOpen={noop} />,
      FamilyScreen: <FamilyScreen services={c.services} active />,
      PasswordScreen: <PasswordScreen services={c.services} active onClose={noop} />,
      PermissionsScreen: <PermissionsScreen active onNotifications={noop} />,
      DiagnosticsScreen: <DiagnosticsScreen services={c.diagnosticServices} active />,
    };
    const element = elements[name];
    if (element === undefined) throw new Error(`Unknown settings screen ${name}`);
    return { dispose: c.dispose, network: () => c.http.requests,
      element: <ReplicaProvider store={c.store}>{element}</ReplicaProvider> };
  } }));

const walkCases: ScreenCase[] = ['WalksScreen', 'WalkDetailScreen'].map((name) => ({ name, async scene() {
  const c = await historyContext();
  const pet = c.seedPet({ species: 'dog' });
  const walk = c.seedWalk({ pet_id: pet.id, status: 'finished', has_route: false,
    ended_at: new Date(c.clock.now()).toISOString() });
  return { dispose: c.dispose, network: () => c.http.requests,
    element: <ReplicaProvider store={c.store}>{name === 'WalksScreen'
      ? <WalksScreen services={c.services} active locationState="granted" onStart={noop} onResume={noop}
        onOpenWalk={noop} onRequestLocation={noop} onOpenSettings={noop} />
      : <WalkDetailScreen services={c.services} walkId={walk.id} active onDiscarded={noop} />}</ReplicaProvider> };
} }));

const screens: ScreenCase[] = [...authCases, ...petCases, ...taskCases, ...settingsCases, ...walkCases,
  { name: 'DashboardScreen', async scene() {
    const c = await dashboardContext();
    const pet = c.seedPet();
    c.seedTask({ pet_ids: [pet.id], times_of_day: [], recurrence: { freq: 'daily', interval: 1 } });
    return { dispose: c.dispose, network: () => c.http.requests,
      element: <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
        <DashboardScreen services={c.services} active onAdd={noop} onManage={noop} onOpenPet={noop} onOpenTask={noop} />
      </AssetFilesProvider></ReplicaProvider> };
  } },
  { name: 'LiveWalkScreen', async scene() {
    const c = await liveContext();
    return { dispose: async () => { await c.tracker.stop(); c.driver.close(); },
      element: <ReplicaProvider store={c.store}><LiveWalkScreen {...c.props} /></ReplicaProvider> };
  } },
  { name: 'LocationPermissionScreen', async scene() {
    // Native permission boundary: denied location keeps real permission UI visible.
    const permissions: LocationPermissions = {
      manufacturer: null, readLocationState: async () => 'denied', readLadder: async () => ['location'],
      requestLocation: async () => 'denied', requestNotifications: async () => false,
      openLocationSettings: async () => {}, openBatterySettings: async () => {}, openBackgroundSettings: async () => {},
      readRows: async () => ({ location: 'denied', backgroundLocation: 'denied', batteryOptimizationEnabled: true, camera: 'denied' }),
      requestCamera: async () => false, openCameraSettings: async () => {}, start: async () => {}, subscribe: () => noop, dispose: noop,
    };
    return { dispose: permissions.dispose,
      element: <LocationPermissionScreen permissions={permissions} active onComplete={noop} /> };
  } },
];

async function paint(entry: ScreenCase, scheme: 'light' | 'dark'): Promise<RenderResult> {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  current = await entry.scene();
  const view = await render(current.element);
  expect(PixelRatio.getFontScale()).toBe(1.3);
  expect(view.root).not.toBeNull();
  return view;
}

// PlaceholderScreen has no remaining route; audit all 24 routed feature screens.
describe.each(screens)('P7-2 P9 $name', (entry) => {
  test.each(['light', 'dark'] as const)('%s resolved root, card and text styles equal theme tokens', async (scheme) => {
    const view = await paint(entry, scheme);
    if (view.root === null) throw new Error('Screen did not render');
    expect(nodes(view.root).some((node) => node.type === 'Text')).toBe(true);
    if (['PetsGridScreen', 'PetProfileScreen', 'TasksListScreen', 'TaskDetailScreen', 'DashboardScreen', 'WalksScreen'].includes(entry.name)) {
      expect(cards(view.root).length).toBeGreaterThan(0);
    }
    expect(themeProblems(view.root, scheme)).toEqual([]);
  });

  test.each(['light', 'dark'] as const)('%s Pressables have labels and roles; native inputs keep Q-33 semantics', async (scheme) => {
    const view = await paint(entry, scheme);
    if (view.root === null) throw new Error('Screen did not render');
    expect(pressables(view.root).length).toBeGreaterThan(0);
    expect(accessibilityProblems(view.root)).toEqual([]);
  });

  test.each(['light', 'dark'] as const)('%s at 130%% font scale every Pressable guarantees 44x44 dp including hitSlop', async (scheme) => {
    const view = await paint(entry, scheme);
    if (view.root === null) throw new Error('Screen did not render');
    expect(pressables(view.root).length).toBeGreaterThan(0);
    expect(targetProblems(view.root)).toEqual([]);
  });
});
