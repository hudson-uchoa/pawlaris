import { Camera, Layer } from '@maplibre/maplibre-react-native';
import { localDate, type RoutePoint } from '@pawlaris/shared';
import { Group } from '@shopify/react-native-skia';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { getAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../assets/useAssetFile';
import { DashboardScreen } from '../../features/dashboard/DashboardScreen';
import { dashboardContext, type DashboardContext } from '../../features/dashboard/__tests__/support';
import { SyncIndicator } from '../../features/shell/SyncIndicator';
import { RollingDistance } from '../../features/walks/RollingDistance';
import { SavedRoute } from '../../features/walks/SavedRoute';
import { WalkMap } from '../../features/walks/WalkMap';
import { formatDistance } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { ReplicaProvider } from '../../replica/useReplica';
import { atlasAlphas, atlasTransforms } from '../cosmos/__tests__/skyDrawing';
import { ConstellationLine } from '../cosmos/ConstellationLine';
import { Orbit } from '../cosmos/Orbit';
import { PoweredBy } from '../cosmos/PoweredBy';
import { ShootingStars } from '../cosmos/ShootingStars';
import { StarCheck } from '../cosmos/StarCheck';
import { Starfield } from '../cosmos/Starfield';
import { duration, hold } from '../motion/tokens';
import { Button } from '../primitives/Button';
import { PressableScale } from '../primitives/PressableScale';
import { Sheet } from '../primitives/Sheet';
import { Skeleton } from '../primitives/Skeleton';
import { Text } from '../primitives/Text';
import { ToastHost, ToastProvider, useToast } from '../primitives/Toast';
import { dark } from '../tokens/color';
import { advance, animationUtil, delayAnimation, repeatAnimation, springAnimation, timingAnimation } from './motionAuditSupport';

jest.mock('react-native/Libraries/Utilities/useColorScheme');
// Mock the native preference at the Reanimated hook boundary. Keep the real
// wrapper and all drawing, domain functions and animation worklets intact.
jest.mock('react-native-reanimated', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native-reanimated')),
  useReducedMotion: { value: jest.fn(), configurable: true, enumerable: true },
}));

const initialAppState = AppState.currentState;
let context: DashboardContext | undefined;
const hidden = { includeHiddenElements: true };
type RenderedView = Awaited<ReturnType<typeof render>>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.mocked(useReducedMotion).mockReturnValue(true);
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

function celebration() {
  return <Starfield seed={42} width={360} height={240} active>
    <Group transform={[{ translateX: 0 }]}>
      <ShootingStars width={360} height={240} active play />
    </Group>
  </Starfield>;
}

function expectBright(view: RenderedView): void {
  const alphas = atlasAlphas(view);
  expect(alphas.length).toBeGreaterThan(0);
  expect(alphas.every((alpha) => alpha === 1)).toBe(true);
}

async function dashboard() {
  const c = await dashboardContext();
  context = c;
  const tree = <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <DashboardScreen services={c.services} active onAdd={c.onAdd}
      onManage={c.onManage} onOpenPet={c.onOpenPet} />
  </AssetFilesProvider></ReplicaProvider>;
  return { c, tree };
}

test('MO-3 Starfield twinkle, nebula breath, parallax: the same sky, still', async () => {
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const scroll = await renderHook(() => useSharedValue(120));
  const view = await render(<Starfield active seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  const alphas = atlasAlphas(view);
  const positions = atlasTransforms(view).map((point) => [point.tx, point.ty]);
  const clouds = view.container.queryAll((node) => node.type === 'skCircle' && node.props.c !== undefined);
  const opacity = () => clouds.map((node) => (node.props.opacity as SharedValue<number>).get());
  const nebula = opacity();
  expect(alphas).toHaveLength(70);
  expect(clouds).toHaveLength(2);
  await act(() => { scroll.result.current.set(240); });
  await advance(700);
  expect(atlasAlphas(view)).toEqual(alphas);
  expect(atlasTransforms(view).map((point) => [point.tx, point.ty])).toEqual(positions);
  expect(opacity()).toEqual(nebula);
  expect(repeat).not.toHaveBeenCalled();
});

test('MO-3 Meteors and satellites in the sky: none', async () => {
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(<Starfield active seed={42} width={360} height={800} density="full" />);
  expect(atlasAlphas(view)).toHaveLength(160);
  expect(view.container.queryAll((node) => node.type === 'skLine')).toHaveLength(0);
  // Both moving heads carry a shared cx; the still planets use numeric cx.
  expect(view.container.queryAll((node) => node.type === 'skCircle'
    && typeof node.props.cx === 'object')).toHaveLength(0);
  await advance(700);
  expect(repeat).not.toHaveBeenCalled();
});

function Check() {
  const [checked, setChecked] = useState(false);
  return <StarCheck checked={checked} active accessibilityLabel="Care" testID="audit-check"
    onPress={() => { setChecked(true); }} />;
}

test('MO-3 Star ignition with its burst: 120 ms fade, no scale, no burst', async () => {
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  await render(<Check />);
  await advance(0);
  await fireEvent(screen.getByRole('checkbox'), 'pressIn');
  expect(screen.getByRole('checkbox')).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  await fireEvent.press(screen.getByRole('checkbox'));
  await advance(0);
  expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
  expect(screen.getByTestId('audit-check-star', hidden)).toHaveAnimatedStyle({ transform: [{ scale: 1 }], opacity: 0 });
  expect(timing).toHaveBeenCalledWith(1, { duration: duration.micro });
  await advance(duration.micro + 32);
  expect(screen.getByTestId('audit-check-star', hidden)).toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
  expect(screen.queryByTestId('audit-check-sparks', hidden)).toBeNull();
  expect(spring).not.toHaveBeenCalled();
  expect(repeat).not.toHaveBeenCalled();
});

test('MO-3 The supernova of complete sky: none; the sky is bright and still', async () => {
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const view = await render(celebration());
  await advance(0);
  expectBright(view);
  const placement = view.container.queryAll((node) => node.type === 'skGroup'
    && Array.isArray(node.props.transform))[0];
  expect(placement).toBeDefined();
  expect(placement?.queryAll((node) => node.type === 'skCircle' || node.type === 'skPath')).toHaveLength(0);
  await advance(700);
  expectBright(view);
  expect(repeat).not.toHaveBeenCalled();
  expect(spring).not.toHaveBeenCalled();
});

test('MO-3 Constellation draw-on: the line appears', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const points = [{ x: 12, y: 12 }, { x: 42, y: 52 }, { x: 102, y: 52 }];
  const view = await render(<ConstellationLine points={points} width={120} height={64} complete={false} active testID="line" />);
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  expect(screen.getByTestId('line', hidden)).toBeOnTheScreen();
  expect(view.container.queryAll((node) => node.props.d === 'M12 12 L42 52 L102 52')).toHaveLength(1);
  expect(timing).not.toHaveBeenCalled();
  await view.unmount();
  expect(cancel.mock.calls[0]?.[0].value).toBe(0);
});

test('MO-3 Orbit satellite, sync orbit: static ring and static sync dot', async () => {
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const state = { status: 'syncing' as const, server: 'primary' as const, outboxCount: 1 };
  const connection = { getState: () => state,
    subscribe: () => () => {} };
  const view = await render(<><Orbit petId="pet-a" size={96} active satellite testID="orbit" />
    <SyncIndicator connection={connection} active /></>);
  expect(screen.queryByTestId('orbit-satellite', hidden)).toBeNull();
  expect(view.container.queryAll((node) => node.type === 'RNSVGCircle')).toHaveLength(2);
  const dot = getAnimatedStyle(screen.getByTestId('sync-indicator-dot', hidden));
  await advance(700);
  expect(getAnimatedStyle(screen.getByTestId('sync-indicator-dot', hidden))).toEqual(dot);
  expect(repeat).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
});

test('MO-3 Shooting stars: complete sky header with a still, bright sky', async () => {
  const { c, tree } = await dashboard();
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], times_of_day: [], completion_mode: 'together' });
  c.mutations.createCompletion({ task_id: task.id, occurrence_key: localDate(c.clock.now(), 'America/Sao_Paulo'),
    pet_id: null, completed_at: new Date(c.clock.now()).toISOString(), photo_asset_id: null, note: null });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(tree);
  await advance(0);
  expect(screen.getByRole('header', { name: strings.dashboard.completeSky })).toBeOnTheScreen();
  expect(view.container.queryAll((node) => node.type === 'skLine')).toHaveLength(0);
  expectBright(view);
  await advance(700);
  expectBright(view);
  expect(repeat).not.toHaveBeenCalled();
});

test('MO-3 List stagger, skeleton sweep: all at once; static placeholder', async () => {
  const { c, tree } = await dashboard();
  const pet = c.seedPet();
  for (let index = 0; index < 7; index += 1) c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(<>{tree}<Skeleton width={240} height={48} active testID="audit-skeleton" /></>);
  const entries = screen.getAllByTestId(/^entry-/);
  expect(entries).toHaveLength(7);
  for (const entry of entries) expect(entry).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  expect(screen.getByTestId('dashboard-list').props.itemLayoutAnimation).toBeUndefined();
  const placeholder = screen.getByTestId('audit-skeleton', hidden);
  expect(placeholder).toHaveStyle({ backgroundColor: dark.surfaceSunken });
  expect(placeholder.children).toHaveLength(0);
  await advance(700);
  expect(view.container.queryAll((node) => node.props.testID === 'audit-skeleton')).toHaveLength(1);
  expect(delay).not.toHaveBeenCalled();
  expect(repeat).not.toHaveBeenCalled();
});

test('MO-3 Comet tail, pulsar, rolling digits, route draw-on: static dot; digits snap; route shown', async () => {
  const route: RoutePoint[] = [[0, 0, 1000, 4], [0.001, 0, 4000, 4], [0.002, 0, 7000, 4]];
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<><WalkMap points={route} mode="live" active />
    <RollingDistance value={formatDistance(0)} active /></>);
  await view.rerender(<><WalkMap points={route} mode="live" active />
    <RollingDistance value={formatDistance(21)} active /></>);
  expect(screen.getByTestId('walk-position')).toHaveStyle({ backgroundColor: dark.star });
  expect(screen.getByTestId('walk-fix-pulse')).toHaveAnimatedStyle({ opacity: 0 });
  expect(jest.mocked(Camera).mock.lastCall?.[0].duration).toBe(0);
  expect(jest.mocked(Layer).mock.calls.some(([props]) => props.id === 'walk-tail-line')).toBe(false);
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(21));
  expect(screen.queryAllByTestId(/^walk-distance-digit-/, hidden)).toHaveLength(0);
  await view.unmount();
  cancel.mockClear();
  const done = jest.fn();
  await render(<SavedRoute points={[[20, 20], [120, 20], [120, 120]]}
    width={200} height={200} active onDrawn={done} />);
  // As in P6-5, SVG host props are a snapshot. Observe the real shared
  // progress exposed by cancellation, rather than a stale native dash.
  expect(screen.getByTestId('walk-route-stroke')).toBeOnTheScreen();
  expect(cancel.mock.calls[0]?.[0].value).toBe(1);
  expect(done).toHaveBeenCalledTimes(1);
  expect(timing).not.toHaveBeenCalled();
  expect(repeat).not.toHaveBeenCalled();
});

test('MO-3 Sheet spring, in and out: 150 ms fade', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const spring = jest.spyOn(springAnimation, 'withSpring');
  await render(<Sheet visible active accessibilityLabel="Care details" dismissLabel="Close" onDismiss={jest.fn()} testID="audit-sheet">
    <Text>Care</Text>
  </Sheet>);
  expect(duration.reducedFade).toBe(150);
  expect(timing).toHaveBeenCalledWith(1, { duration: duration.reducedFade });
  expect(screen.getByTestId('audit-sheet')).toHaveAnimatedStyle({ opacity: 0 });
  expect(getAnimatedStyle(screen.getByTestId('audit-sheet')).transform).toBeUndefined();
  await advance(duration.reducedFade + 32);
  expect(screen.getByTestId('audit-sheet')).toHaveAnimatedStyle({ opacity: 1 });
  timing.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(timing).toHaveBeenCalledWith(0, { duration: duration.reducedFade }, expect.any(Function));
  expect(screen.getByRole('dialog')).toBeOnTheScreen();
  await advance(duration.reducedFade + 32);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(spring).not.toHaveBeenCalled();
});

function ToastTrigger() {
  const toast = useToast();
  return <Button label="Show" accessibilityLabel="Show notice" onPress={() => { toast.show('Care saved'); }} />;
}

test('MO-3 Toast in and out: 150 ms fade; the hold is the same', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const spring = jest.spyOn(springAnimation, 'withSpring');
  await render(<ToastProvider dismissLabel="Dismiss"><ToastTrigger /><ToastHost active /></ToastProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Show notice' }));
  expect(timing).toHaveBeenCalledWith(1, { duration: duration.reducedFade }, expect.any(Function));
  expect(screen.getByTestId('toast')).toHaveAnimatedStyle({ opacity: 0, transform: [{ translateY: 0 }] });
  // Reuse the Toast test's frame-by-frame settling, so the hold begins at
  // the real animation callback instead of an assumed wall-clock offset.
  for (let frame = 0; frame < 20 && getAnimatedStyle(screen.getByTestId('toast')).opacity !== 1; frame += 1) await advance(16);
  expect(screen.getByTestId('toast')).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  timing.mockClear();
  expect(hold.toast).toBe(4000);
  await advance(hold.toast - 32);
  expect(screen.getByRole('alert')).toHaveTextContent('Care saved');
  expect(timing).not.toHaveBeenCalled();
  await advance(64);
  expect(timing).toHaveBeenCalledWith(0, { duration: duration.reducedFade }, expect.any(Function));
  expect(screen.getByTestId('toast')).toHaveAnimatedStyle({ transform: [{ translateY: 0 }] });
  await advance(duration.reducedFade + 32);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(spring).not.toHaveBeenCalled();
});

test('MO-3 PressableScale press: no scale; it stays at 1', async () => {
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const onPress = jest.fn();
  await render(<PressableScale accessibilityLabel="Care" active onPress={onPress} />);
  const button = screen.getByRole('button', { name: 'Care' });
  await fireEvent(button, 'pressIn');
  await advance(100);
  expect(button).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  await fireEvent(button, 'pressOut');
  await fireEvent.press(button);
  await advance(100);
  expect(button).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(spring).not.toHaveBeenCalled();
});

test('MO-3 The ring of the Insurge signature breathing: a still ring', async () => {
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<PoweredBy active testID="signature" />);
  expect(screen.getByLabelText('powered by Insurge')).toBeOnTheScreen();
  const ring = view.container.queryAll((node) => Number(node.props.r) === 12);
  expect(ring).toHaveLength(1);
  await advance(700);
  await view.unmount();
  expect(cancel.mock.calls[0]?.[0].value).toBe(1);
  expect(repeat).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
});
