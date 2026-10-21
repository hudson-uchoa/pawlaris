import { cleanup, render } from '@testing-library/react-native';
import type { SkColor } from '@shopify/react-native-skia';
import type { ReactElement } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { useReducedMotion, type SharedValue } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../assets/useAssetFile';
import { authContext, type AuthContext } from '../../features/auth/__tests__/support';
import { LoginScreen } from '../../features/auth/LoginScreen';
import { RedeemScreen } from '../../features/auth/RedeemScreen';
import { dashboardContext, type DashboardContext } from '../../features/dashboard/__tests__/support';
import { DashboardScreen } from '../../features/dashboard/DashboardScreen';
import { petContext, type PetContext } from '../../features/pets/__tests__/support';
import { PetProfileScreen } from '../../features/pets/PetProfileScreen';
import { PetsGridScreen } from '../../features/pets/PetsGridScreen';
import { ReplicaProvider } from '../../replica/useReplica';
import { atlasAlphas } from '../cosmos/__tests__/skyDrawing';
import { HeroProvider } from '../motion/hero';
import { advance, animationUtil, repeatAnimation } from './motionAuditSupport';

jest.mock('react-native/Libraries/Utilities/useColorScheme');
jest.mock('react-native-reanimated', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native-reanimated')),
  useReducedMotion: { value: jest.fn(), configurable: true, enumerable: true },
}));

const initialAppState = AppState.currentState;
let context: AuthContext | DashboardContext | PetContext | undefined;
type RenderedView = Awaited<ReturnType<typeof render>>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.mocked(useReducedMotion).mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

function allSkyAlphas(view: RenderedView): number[][] {
  const atlases = view.container.queryAll((node) => node.type === 'skAtlas');
  expect(atlases.length).toBeGreaterThan(0);
  // The shared helper reads the first canvas. Include any empty-state sky
  // as well, since its clock must stop independently of the header's.
  return [atlasAlphas(view), ...atlases.slice(1).map((atlas) =>
    (atlas.props.colors as SharedValue<SkColor[]>).get().map((color) => color[3] ?? 0))];
}

async function expectSkyStops(tree: (active: boolean) => ReactElement): Promise<void> {
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(tree(true));
  await advance(0);
  const initial = allSkyAlphas(view);
  expect(initial.length).toBeGreaterThan(0);
  expect(initial.every((sky) => sky.length > 0)).toBe(true);
  await advance(700);
  expect(allSkyAlphas(view)).not.toEqual(initial);
  cancel.mockClear();
  repeat.mockClear();
  await view.rerender(tree(false));
  await advance(0);
  expect(cancel).toHaveBeenCalled();
  const frozen = allSkyAlphas(view);
  const values = [...new Set(cancel.mock.calls.map(([value]) => value))];
  const stopped = values.map((value) => value.value);
  await advance(700);
  expect(allSkyAlphas(view)).toEqual(frozen);
  expect(values.map((value) => value.value)).toEqual(stopped);
  expect(repeat).not.toHaveBeenCalled();
}

test('P6 LoginScreen Starfield stops its ambient animation on focus loss', async () => {
  const c = await authContext();
  context = c;
  await expectSkyStops((active) => <LoginScreen services={c.services} active={active} onRedeem={jest.fn()} />);
});

test('P6 RedeemScreen Starfield stops its ambient animation on focus loss', async () => {
  const c = await authContext();
  context = c;
  await expectSkyStops((active) => <RedeemScreen services={c.services} active={active} />);
});

test('P6 DashboardScreen Starfields stop their ambient animation on focus loss', async () => {
  const c = await dashboardContext();
  context = c;
  await expectSkyStops((active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <DashboardScreen services={c.services} active={active} onAdd={c.onAdd} onManage={c.onManage} onOpenPet={c.onOpenPet} />
  </AssetFilesProvider></ReplicaProvider>);
});

test('P6 PetProfileScreen Starfield stops its ambient animation on focus loss', async () => {
  const c = await petContext();
  context = c;
  const pet = c.seedPet();
  await expectSkyStops((active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <HeroProvider active={active}><PetProfileScreen services={c.services} petId={pet.id} active={active}
      onEdit={jest.fn()} onAddWeight={jest.fn()} onAddHealth={jest.fn()} onOpenHealth={jest.fn()} onWalks={jest.fn()} />
    </HeroProvider>
  </AssetFilesProvider></ReplicaProvider>);
});

test('P6 PetsGridScreen empty-state Starfield stops its ambient animation on focus loss', async () => {
  const c = await petContext();
  context = c;
  await expectSkyStops((active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <HeroProvider active={active}><PetsGridScreen services={c.services} active={active} onAdd={c.onAdd} onOpenPet={c.onOpenPet} /></HeroProvider>
  </AssetFilesProvider></ReplicaProvider>);
});
