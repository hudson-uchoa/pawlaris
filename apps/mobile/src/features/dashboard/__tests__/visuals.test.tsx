import { Skia, type SkColor, type SkRSXform } from '@shopify/react-native-skia';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, View, useColorScheme } from 'react-native';
import { LinearTransition, type SharedValue } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { createStartupMarker } from '../../../perf/marker';
import { ReplicaProvider } from '../../../replica/useReplica';
import { generateSky } from '../../../ui/cosmos/sky';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { dark, light } from '../../../ui/tokens/color';
import { DashboardScreen } from '../DashboardScreen';
import { DashboardEntry } from '../DashboardEntry';
import { dashboardMotion } from '../motion';
import { dashboardContext, type DashboardContext } from './support';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const delayAnimation = jest.requireActual<Pick<AnimationAPI, 'withDelay'>>(`${animationRoot}/animation/delay`);
const initialAppState = AppState.currentState;
let context: DashboardContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  expect(context?.http.requests ?? []).toEqual([]);
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene() {
  const c = await dashboardContext();
  context = c;
  return c;
}

function tree(c: DashboardContext, active = true) {
  return <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <DashboardScreen services={c.services} active={active} onAdd={c.onAdd} onManage={c.onManage} onOpenPet={c.onOpenPet} />
  </AssetFilesProvider></ReplicaProvider>;
}

type DrawingNode = Awaited<ReturnType<typeof render>>['container'];

function headerCanvas(): DrawingNode {
  const header = screen.getByTestId('dashboard').children[0];
  if (header === undefined || typeof header === 'string') throw new Error('Missing dashboard sky header');
  const canvas = header.children[0];
  if (canvas === undefined || typeof canvas === 'string') throw new Error('Missing dashboard sky canvas');
  return canvas;
}

function atlas(node: DrawingNode): DrawingNode {
  const atlases = node.queryAll((child) => child.type === 'skAtlas');
  expect(atlases).toHaveLength(1);
  const drawing = atlases[0];
  if (drawing === undefined) throw new Error('Missing sky atlas');
  return drawing;
}

function alphas(drawing: DrawingNode): number[] {
  return (drawing.props.colors as SharedValue<SkColor[]>).get().map((color) => color[3] ?? 0);
}

function transforms(drawing: DrawingNode): number[][] {
  return (drawing.props.transforms as SharedValue<SkRSXform[]>).get()
    .map(({ scos, ssin, tx, ty }) => [scos, ssin, tx, ty]);
}

function expectHeaderOffsets(offsets: readonly [number, number, number]): void {
  const canvas = headerCanvas();
  const { width, height } = canvas.props.style as { width: number; height: number };
  const stars = generateSky(dashboardMotion.skySeed, { width, height, density: 'band' }).stars;
  const values = (atlas(canvas).props.transforms as SharedValue<SkRSXform[]>).get();
  expect(values).toHaveLength(70);
  const depths = new Set<number>();
  stars.forEach((star, index) => {
    const depth = star.magnitude >= 5 ? 0 : star.magnitude >= 3 ? 1 : 2;
    depths.add(depth);
    const radius = 0.5 + (6 - star.magnitude) * 0.35;
    // RSXform stores GPU coordinates as float32; retain the exact depth
    // offsets while comparing the encoded coordinates without a tolerance.
    expect(values[index]?.ty).toBe(Math.fround(star.y - radius * 2 + offsets[depth]));
  });
  expect(depths).toEqual(new Set([0, 1, 2]));
}

test.each(['light', 'dark'] as const)('P9 dashboard uses %s tokens and keeps only the header sky animated', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const c = await scene();
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const gradient = jest.spyOn(Skia.Shader, 'MakeLinearGradient');
  const view = await render(tree(c));
  const colors = scheme === 'light' ? light : dark;
  expect(screen.getByTestId('dashboard')).toHaveStyle({ backgroundColor: colors.bg });
  expect(gradient.mock.calls.map(([, , colors]) => colors)).toEqual([
    [Skia.Color(colors.skyTop), Skia.Color(colors.skyBottom)],
    [Skia.Color(colors.skyTop), Skia.Color(colors.skyBottom)],
  ]);
  expect(view.container.queryAll((node) => node.type === 'skPicture')).toHaveLength(2);
  const skies = view.container.queryAll((node) => node.type === 'skAtlas');
  expect(skies).toHaveLength(2);
  const header = atlas(headerCanvas());
  const empty = skies.find((drawing) => drawing !== header);
  if (empty === undefined) throw new Error('Missing empty-state sky');
  const scenes = view.container.queryAll((node) => node.type === 'skGroup'
    && Array.isArray(node.props.transform) && node.props.transform.length === 3);
  expect(scenes).toHaveLength(1);
  expect(scenes.flatMap((group) => group.queryAll((node) => node.type === 'skPath'))).toHaveLength(4);
  const headerBefore = alphas(header);
  const emptyBefore = alphas(empty);
  await act(async () => { await jest.advanceTimersByTimeAsync(700); });
  expect(alphas(header)).not.toEqual(headerBefore);
  expect(alphas(empty)).toEqual(emptyBefore);
  expect(repeat).not.toHaveBeenCalled();
});

test('P6 dashboard scroll drives the three header magnitude depths', async () => {
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  await render(tree(c));
  expectHeaderOffsets([0, 0, 0]);
  await fireEvent.scroll(screen.getByTestId('dashboard-list'), {
    nativeEvent: { contentOffset: { x: 0, y: 120 }, contentSize: { width: 360, height: 1200 },
      layoutMeasurement: { width: 360, height: 720 } },
  });
  await act(async () => { await jest.advanceTimersByTimeAsync(32); });
  expectHeaderOffsets([-4.8, -9.6, -19.2]);
});

test('P6 P9 an inactive dashboard stops ambient motion and does not replay card entry on focus', async () => {
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const view = await render(tree(c));
  const header = atlas(headerCanvas());
  expect(transforms(header)).toHaveLength(70);
  expect(delay).toHaveBeenCalledTimes(1);
  const initial = alphas(header);
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  const running = alphas(header);
  const positions = transforms(header);
  expect(running).not.toEqual(initial);
  delay.mockClear();
  repeat.mockClear();
  await view.rerender(tree(c, false));
  expect(alphas(header)).toEqual(running);
  expect(transforms(header)).toEqual(positions);
  await act(async () => { await jest.advanceTimersByTimeAsync(10_600); });
  expect(alphas(header)).toEqual(running);
  expect(transforms(header)).toEqual(positions);
  expect(repeat).not.toHaveBeenCalled();
  expect(delay).not.toHaveBeenCalled();
  await view.rerender(tree(c));
  expect(transforms(header)).toHaveLength(70);
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  expect(alphas(header)).not.toEqual(running);
  expect(repeat).not.toHaveBeenCalled();
  expect(delay).not.toHaveBeenCalled();
});

test('P9 reduced dashboard renders still stars and cards without parallax or entry animation', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const view = await render(tree(c));
  const header = atlas(headerCanvas());
  expect(view.container.queryAll((node) => node.type === 'skAtlas')).toHaveLength(1);
  expectHeaderOffsets([0, 0, 0]);
  const still = alphas(header);
  const positions = transforms(header);
  await fireEvent.scroll(screen.getByTestId('dashboard-list'), {
    nativeEvent: { contentOffset: { x: 0, y: 120 }, contentSize: { width: 360, height: 1200 },
      layoutMeasurement: { width: 360, height: 720 } },
  });
  await act(async () => { await jest.advanceTimersByTimeAsync(10_600); });
  expect(alphas(header)).toEqual(still);
  expect(transforms(header)).toEqual(positions);
  expectHeaderOffsets([0, 0, 0]);
  expect(repeat).not.toHaveBeenCalled();
  expect(delay).not.toHaveBeenCalled();
  for (const entry of screen.getAllByTestId(/^entry-/)) {
    expect(entry).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  }
});

test('06-4.8 the first six cards enter once with a 12 dp rise and 40 ms stagger', async () => {
  const entered = new Set<string>();
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  function entries(enabled: boolean) {
    return <View>{Array.from({ length: 7 }, (_, index) => <DashboardEntry key={index} id={`card-${index}`}
      index={index} entered={entered} enabled={enabled}><View /></DashboardEntry>)}</View>;
  }
  const view = await render(entries(true));
  expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([0, 40, 80, 120, 160, 200]);
  expect(screen.getByTestId('entry-card-0')).toHaveAnimatedStyle({ opacity: 0, transform: [{ translateY: 12 }] });
  expect(screen.getByTestId('entry-card-6')).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  await view.rerender(entries(false));
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  for (const entry of screen.getAllByTestId(/^entry-/)) {
    expect(entry).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  }
  delay.mockClear();
  await view.rerender(entries(true));
  await view.unmount();
  await render(entries(true));
  expect(delay).not.toHaveBeenCalled();
});

test('P6 P9 dashboard layout transitions are configured only while motion is enabled', async () => {
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const build = jest.spyOn(LinearTransition, 'build');
  const view = await render(tree(c));
  expect(build).toHaveBeenCalled();
  build.mockClear();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  await view.rerender(tree(c));
  expect(build).not.toHaveBeenCalled();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  await view.rerender(tree(c, false));
  expect(build).not.toHaveBeenCalled();
});

test('R6.1 dashboard marks the ready layout once through the startup marker', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const c = await scene();
  const output = jest.fn();
  c.services.marker = createStartupMarker(output);
  await render(tree(c));
  expect(output).not.toHaveBeenCalled();
  const event = { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } } };
  await fireEvent(screen.getByTestId('dashboard'), 'layout', event);
  await fireEvent(screen.getByTestId('dashboard'), 'layout', event);
  expect(c.services.afterFirstPaint).toHaveBeenCalled();
  expect(output).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledWith('PAWLARIS_PERF dashboard_interactive');
});
