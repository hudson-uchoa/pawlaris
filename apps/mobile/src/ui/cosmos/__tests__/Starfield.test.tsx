import { Circle } from '@shopify/react-native-skia';
import { act, cleanup, render, renderHook } from '@testing-library/react-native';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { dark, light } from '../../tokens/color';
import { Starfield } from '../Starfield';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const initialAppState = AppState.currentState;
type RenderedView = Awaited<ReturnType<typeof render>>;
type Translation = SharedValue<{ translateY: number }[]>;

function translations(view: RenderedView): Translation[] {
  return view.container.queryAll((node) => node.type === 'skGroup' && node.props.transform !== undefined)
    .map((node) => node.props.transform as Translation);
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

test('Q-36 parallax moves each layer upward and clamps scroll before multiplying', async () => {
  const scroll = await renderHook(() => useSharedValue(120));
  const view = await render(<Starfield active seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  const offsets = () => translations(view).map((value) => value.get()[0]?.translateY);
  expect(offsets()).toEqual([-4.8, -9.6, -19.2]);
  await act(async () => { scroll.result.current.set(1000); await jest.advanceTimersByTimeAsync(0); });
  expect(offsets()).toEqual([-9.6, -19.2, -38.4]);
  await act(async () => { scroll.result.current.set(-100); await jest.advanceTimersByTimeAsync(0); });
  for (const offset of offsets()) expect(offset).toBeCloseTo(0);
});

test.each(['focus', 'background', 'reduce motion'] as const)('P6/P9 %s stops parallax subscriptions while keeping still stars', async (reason) => {
  let notify: () => void = () => { throw new Error('Missing app lifecycle subscription'); };
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    notify = () => { (listener as (state: AppStateStatus) => void)('background'); };
    return { remove: jest.fn() };
  });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const scroll = await renderHook(() => useSharedValue(120));
  const view = await render(<Starfield active seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  const previous = translations(view);
  expect(previous).toHaveLength(3);
  const values = previous.map((value) => value.get());
  repeat.mockClear();
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; notify(); });
  } else {
    if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    await view.rerender(<Starfield active={reason !== 'focus'} seed={42} width={360} height={240} scrollY={scroll.result.current} />);
  }
  expect(translations(view)).toHaveLength(0);
  // Worklets schedules mapper disposal on the UI queue.
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  await act(async () => { scroll.result.current.set(240); await jest.advanceTimersByTimeAsync(10600); });
  expect(previous.map((value) => value.get())).toEqual(values);
  expect(repeat).not.toHaveBeenCalled();
  expect(view.container.queryAll((node) => node.type === 'skPoints')).toHaveLength(3);
});

test('Q-36 defaults to a header without nebula and draws the specified optional clouds', async () => {
  const view = await render(<Starfield active={false} seed={42} width={360} height={240} />);
  expect(view.container.queryAll((node) => node.type === 'skPoints')
    .reduce((count, node) => count + (node.props.points as unknown[]).length, 0)).toBe(60);
  expect(view.container.queryAll((node) => node.type === 'skRadialGradient')).toHaveLength(0);
  await view.rerender(<Starfield active={false} seed={42} width={360} height={240} nebula />);
  const clouds = view.container.queryAll((node) => node.type === 'skCircle');
  expect(clouds.map((node) => {
    const center = node.props.c as { x: number; y: number };
    return [{ x: center.x, y: center.y }, node.props.r, node.props.opacity];
  })).toEqual([
    [{ x: 90, y: 60 }, 216, 0.18], [{ x: 270, y: 156 }, 180, 0.18],
  ]);
  const gradients = view.container.queryAll((node) => node.type === 'skRadialGradient');
  expect(gradients).toHaveLength(2);
  expect(gradients.map((node) => (node.props.colors as unknown[])[0])).toEqual([dark.nebulaA, dark.nebulaB]);
  for (const gradient of gradients) {
    const colors = gradient.props.colors as [string, Float32Array];
    expect(colors[1][3]).toBe(0);
  }
  const blur = view.container.queryAll((node) => node.type === 'skBlurMaskFilter');
  expect(blur).toHaveLength(2);
  expect(blur.map((node) => [node.props.style, node.props.blur])).toEqual([['normal', 19.2], ['normal', 19.2]]);
});

test.each(['light', 'dark'] as const)('Q-35 star paints preserve radii and apply the %s opacity factor', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const view = await render(<Starfield active={false} seed={42} width={360} height={240} />);
  const points = view.container.queryAll((node) => node.type === 'skPoints');
  expect(points.map((node) => node.props.strokeWidth)).toEqual([1.2, 2.4, 3.6]);
  expect(points.map((node) => node.props.strokeCap)).toEqual(['round', 'round', 'round']);
  expect(points.map((node) => node.props.color)).toEqual(Array<string>(3).fill(scheme === 'light' ? light.starfield : dark.starfield));
  const opacities = scheme === 'light' ? [0.098, 0.154, 0.224] : [0.35, 0.55, 0.8];
  points.forEach((node, index) => {
    expect(node.parent?.props.opacity).toBeCloseTo(opacities[index] ?? 0);
    expect((node.props.opacity as SharedValue<number>).get()).toBe(1);
  });
});

test('P6 twinkle uses exactly three repeating values with the specified full periods', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  await render(<Starfield active seed={42} width={360} height={240} />);
  expect(timing.mock.calls.map(([target, config]) => [target, config?.duration]))
    .toEqual([[0.55, 1400], [0.55, 2050], [0.55, 2650]]);
  expect(repeat).toHaveBeenCalledTimes(3);
  expect(repeat.mock.calls.every(([, count, reverse]) => count === -1 && reverse === true)).toBe(true);
});

test('P6 additional scene nodes share the Starfield canvas', async () => {
  const view = await render(<Starfield active={false} seed={42} width={360} height={240}>
    <Circle cx={24} cy={24} r={12} color={dark.accent} />
  </Starfield>);
  expect(view.container.queryAll((node) => node.type === 'View')).toHaveLength(1);
  expect(view.container.queryAll((node) => node.type === 'skCircle')).toHaveLength(1);
  expect(view.container.queryAll((node) => node.type === 'skPoints')).toHaveLength(3);
});
