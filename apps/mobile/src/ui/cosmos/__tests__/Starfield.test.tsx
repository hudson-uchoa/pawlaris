import { Circle, Group, Skia } from '@shopify/react-native-skia';
import { act, cleanup, render, renderHook } from '@testing-library/react-native';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { dark, light } from '../../tokens/color';
import { generateSky, starAlpha, starRadius } from '../sky';
import { Starfield } from '../Starfield';
import { atlasAlphas, atlasColors, atlasTransforms } from './skyDrawing';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const initialAppState = AppState.currentState;
const stars = generateSky(42, { width: 360, height: 240, density: 'band' }).stars;
type RenderedView = Awaited<ReturnType<typeof render>>;

function offsets(view: RenderedView): number[] {
  const transforms = atlasTransforms(view);
  return [6, 4, 2].map((magnitude) => {
    const index = stars.findIndex((star) => star.magnitude === magnitude);
    const star = stars[index];
    if (star === undefined) throw new Error('Missing depth sample');
    return (transforms[index]?.ty ?? 0) - star.y + starRadius(star.magnitude) * 2;
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('Q-36 parallax moves each magnitude depth upward and clamps scroll before multiplying', async () => {
  const scroll = await renderHook(() => useSharedValue(120));
  const view = await render(<Starfield active seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  const check = (expected: number[]) => offsets(view).forEach((offset, index) => expect(offset).toBeCloseTo(expected[index] ?? 0));
  check([-4.8, -9.6, -19.2]);
  await act(async () => { scroll.result.current.set(1000); await jest.advanceTimersByTimeAsync(32); });
  check([-9.6, -19.2, -38.4]);
  await act(async () => { scroll.result.current.set(-100); await jest.advanceTimersByTimeAsync(32); });
  for (const offset of offsets(view)) expect(offset).toBeCloseTo(0);
});

test.each(['focus', 'background', 'reduce motion'] as const)('P6/P9 %s stops parallax updates while keeping still stars', async (reason) => {
  let notify: () => void = () => { throw new Error('Missing app lifecycle subscription'); };
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    notify = () => { (listener as (state: AppStateStatus) => void)('background'); };
    return { remove: jest.fn() };
  });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const scroll = await renderHook(() => useSharedValue(120));
  const view = await render(<Starfield active seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  const previous = atlasTransforms(view);
  expect(previous).toHaveLength(70);
  const values = previous.map((value) => [value.tx, value.ty]);
  repeat.mockClear();
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; notify(); });
  } else {
    if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    await view.rerender(<Starfield active={reason !== 'focus'} seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  }
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  await act(async () => { scroll.result.current.set(240); await jest.advanceTimersByTimeAsync(10600); });
  expect(atlasTransforms(view).map((value) => [value.tx, value.ty])).toEqual(values);
  expect(repeat).not.toHaveBeenCalled();
  expect(view.container.queryAll((node) => node.type === 'skAtlas')).toHaveLength(1);
});

test('06 section 4.1 defaults to 70 stars and the specified nebula clouds', async () => {
  const view = await render(<Starfield active={false} seed={42} width={360} height={240} />);
  expect(atlasTransforms(view)).toHaveLength(70);
  const clouds = view.container.queryAll((node) => node.type === 'skCircle' && node.props.c !== undefined);
  expect(clouds.map((node) => {
    const center = node.props.c as { x: number; y: number };
    return [{ x: center.x, y: center.y }, node.props.r, (node.props.opacity as SharedValue<number>).get()];
  })).toEqual([
    [{ x: 90, y: 60 }, 216, 0.18], [{ x: 270, y: 156 }, 180, 0.18],
  ]);
  const gradients = view.container.queryAll((node) => node.type === 'skRadialGradient'
    && [dark.nebulaA, dark.nebulaB].includes(node.props.colors[0]));
  expect(gradients).toHaveLength(2);
  expect(gradients.map((node) => (node.props.colors as unknown[])[0])).toEqual([dark.nebulaA, dark.nebulaB]);
  for (const gradient of gradients) {
    const colors = gradient.props.colors as [string, Float32Array];
    expect(colors[1][3]).toBe(0);
  }
  const blur = view.container.queryAll((node) => node.type === 'skBlurMaskFilter');
  expect(blur).toHaveLength(2);
  expect(blur.map((node) => [node.props.style, node.props.blur])).toEqual([['normal', 19.2], ['normal', 19.2]]);
  await view.rerender(<Starfield active={false} seed={42} width={360} height={240} nebula={false} />);
  expect(view.container.queryAll((node) => node.type === 'skBlurMaskFilter')).toHaveLength(0);
});

test.each(['light', 'dark'] as const)('06 section 4.1 paints the %s atlas by magnitude and tint', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const view = await render(<Starfield active={false} seed={42} width={360} height={240} />);
  const visible = scheme === 'light' ? stars.filter((star) => star.magnitude <= 2) : stars;
  const transforms = atlasTransforms(view);
  const colors = atlasColors(view);
  expect(transforms).toHaveLength(visible.length);
  visible.forEach((star, index) => {
    expect(transforms[index]?.scos).toBeCloseTo(starRadius(star.magnitude) / 8);
    expect(transforms[index]?.ssin).toBe(0);
    const tint = Skia.Color(scheme === 'light' ? light.starfield : star.tint);
    expect(Array.from(colors[index] ?? []).slice(0, 3)).toEqual(Array.from(tint).slice(0, 3));
    expect(colors[index]?.[3]).toBeCloseTo(starAlpha(star, 0) * (scheme === 'light' ? 0.4 : 1));
  });
});

test('P6 twinkle uses one cancellable UI clock and no per-layer repeating timings', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(<Starfield active seed={42} width={360} height={240} />);
  const initial = atlasAlphas(view);
  await act(async () => { await jest.advanceTimersByTimeAsync(700); });
  expect(atlasAlphas(view)).not.toEqual(initial);
  expect(timing).not.toHaveBeenCalled();
  expect(repeat).not.toHaveBeenCalled();
});

test('P6 additional scene nodes share the Starfield canvas', async () => {
  const view = await render(<Starfield active={false} seed={42} width={360} height={240}>
    <Group transform={[{ translateX: 0 }]}>
      <Circle cx={24} cy={24} r={12} color={dark.accent} />
    </Group>
  </Starfield>);
  expect(view.container.queryAll((node) => node.type === 'View')).toHaveLength(1);
  const groups = view.container.queryAll((node) => node.type === 'skGroup' && Array.isArray(node.props.transform));
  expect(groups).toHaveLength(1);
  const scene = groups[0];
  if (scene === undefined) throw new Error('Missing additional-scene group');
  expect(scene.queryAll((node) => node.type === 'skCircle')).toHaveLength(1);
  expect(view.container.queryAll((node) => node.type === 'skAtlas')).toHaveLength(1);
});
