import { Circle, Group } from '@shopify/react-native-skia';
import { act, cleanup, render } from '@testing-library/react-native';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import { ReduceMotion as MotionPolicy, type SharedValue } from 'react-native-reanimated';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { dark, light } from '../../tokens/color';
import { ShootingStars } from '../ShootingStars';
import { Starfield } from '../Starfield';
import { generateSky } from '../sky';
import { atlasAlphas } from './skyDrawing';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const delayAnimation = jest.requireActual<Pick<AnimationAPI, 'withDelay'>>(`${animationRoot}/animation/delay`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
type RenderedView = Awaited<ReturnType<typeof render>>;

function Scene({ play = true, active = true, width = 360, height = 240 }: {
  play?: boolean; active?: boolean; width?: number; height?: number;
}) {
  return <Starfield seed={42} width={width} height={height} active={active}>
    <Group transform={[{ translateX: 0 }]}>
      <ShootingStars width={width} height={height} active={active} play={play} />
    </Group>
  </Starfield>;
}

function starOpacities(view: RenderedView): number[] {
  return atlasAlphas(view);
}

function expectOrdinary(view: RenderedView, scheme: 'light' | 'dark' = 'dark'): void {
  const stars = generateSky(42, { width: 360, height: 240, density: 'band' }).stars
    .filter((star) => scheme === 'dark' || star.magnitude <= 2);
  const alphas = starOpacities(view);
  expect(alphas).toHaveLength(stars.length);
  stars.forEach((star, index) => {
    const base = (0.25 + (6 - star.magnitude) * 0.14) * (scheme === 'light' ? 0.4 : 1);
    const amplitude = star.magnitude <= 2 ? 0.15 : star.magnitude <= 4 ? 0.35 : 0.5;
    expect(alphas[index]).toBeGreaterThanOrEqual(base * (1 - amplitude) - 0.000001);
    expect(alphas[index]).toBeLessThanOrEqual(base + 0.000001);
  });
}

function expectBright(view: RenderedView): void {
  const alphas = starOpacities(view);
  expect(alphas.length).toBeGreaterThan(0);
  expect(alphas.every((alpha) => alpha === 1)).toBe(true);
}

// The fixture's own placement Group encloses only the celebration, including
// its empty reduced-motion output. Ambient sky nodes remain outside it.
function celebrationNodes(view: RenderedView, type: string) {
  const groups = view.container.queryAll((node) => node.type === 'skGroup'
    && Array.isArray(node.props.transform));
  return groups.flatMap((group) => group.queryAll((node) => node !== group && node.type === type));
}

function meteors(view: RenderedView) {
  return celebrationNodes(view, 'skGroup').filter((node) => node.props.transform !== undefined);
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

test.each(['light', 'dark'] as const)('Q-38 five meteors share one canvas and use themed heads and 60 dp fading tails in %s', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const color = scheme === 'light' ? light : dark;
  const view = await render(<Scene />);
  expect(view.container.queryAll((node) => node.type === 'View')).toHaveLength(1);
  expect(view.container.queryAll((node) => node.type === 'skAtlas')).toHaveLength(1);
  const heads = celebrationNodes(view, 'skCircle');
  expect(heads).toHaveLength(5);
  for (const head of heads) {
    expect(head.props.color).toBe(color.star);
    expect(head.props.r).toBe(2);
  }
  const tails = celebrationNodes(view, 'skLine');
  expect(tails).toHaveLength(5);
  for (const tail of tails) {
    const start = tail.props.p1 as { x: number; y: number };
    const end = tail.props.p2 as { x: number; y: number };
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(60);
    expect(tail.props.strokeWidth).toBe(1.75);
  }
  const gradients = celebrationNodes(view, 'skLinearGradient').filter((node) => node.props.colors[1] === color.star);
  expect(gradients).toHaveLength(5);
  for (const gradient of gradients) expect((gradient.props.colors[0] as Float32Array)[3]).toBe(0);
});

test('Q-38 one 1600 ms timeline staggers five 960 ms diagonal crossings by 160 ms', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<Scene />);
  expect(timing.mock.calls.filter(([target]) => target === 1600))
    .toEqual([[1600, expect.objectContaining({ duration: 1600 })]]);
  const visible = () => meteors(view).map((node) => (node.props.opacity as SharedValue<number>).get());
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(visible()).toEqual([1, 0, 0, 0, 0]);
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  expect(visible()).toEqual([1, 1, 0, 0, 0]);
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
  expect(visible()).toEqual([1, 1, 1, 1, 1]);
  const offsets = meteors(view).map((node) => (node.props.transform as SharedValue<[{ translateX: number }, { translateY: number }]>).get());
  offsets.forEach(([x, y], index) => {
    expect(x.translateX).toBeGreaterThan(-60);
    expect(y.translateY).toBeGreaterThan(240 * (0.05 + index * 0.1));
    // Both coordinates advance along the same straight diagonal.
    expect((y.translateY - 240 * (0.05 + index * 0.1)) / (x.translateX + 60)).toBeCloseTo(120 / 480);
  });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(visible()).toEqual([0, 1, 1, 1, 1]);
  await act(async () => { await jest.advanceTimersByTimeAsync(660); });
  expect(visible()).toEqual([0, 0, 0, 0, 0]);
});

test.each(['light', 'dark'] as const)('Q-38 the %s sky rises to full, holds, and settles to its ordinary opacity', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const view = await render(<Scene />);
  const base = starOpacities(view);
  expectOrdinary(view, scheme);
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  starOpacities(view).forEach((opacity, index) => {
    expect(opacity).toBeGreaterThan(base[index] ?? 0);
    expect(opacity).toBeLessThan(1);
  });
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  expectBright(view);
  await act(async () => { await jest.advanceTimersByTimeAsync(1100); });
  expectBright(view);
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  starOpacities(view).forEach((opacity) => { expect(opacity).toBeGreaterThan(0); expect(opacity).toBeLessThan(1); });
  await act(async () => { await jest.advanceTimersByTimeAsync(160); });
  expectOrdinary(view, scheme);
});

test.each(['light', 'dark'] as const)('Q-38 Reduce Motion cuts to a still bright %s sky for 1600 ms without meteors or fades', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expectBright(view);
  expect(meteors(view)).toHaveLength(0);
  expect([...celebrationNodes(view, 'skCircle'), ...celebrationNodes(view, 'skLine')]).toHaveLength(0);
  expect(timing.mock.calls).toEqual([[1600, { duration: 0 }]]);
  expect(delay.mock.calls[0]?.[0]).toBe(1600);
  expect(delay.mock.calls[0]?.[2]).toBe(MotionPolicy.Never);
  expect(spring).not.toHaveBeenCalled();
  expect(repeat).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(1590); });
  expectBright(view);
  await act(async () => { await jest.advanceTimersByTimeAsync(90); });
  expectOrdinary(view, scheme);
});

test('Q-38 rerenders and size changes never replay a consumed request, but a new play edge does', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  await view.rerender(<Scene width={400} height={260} />);
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
  await view.rerender(<Scene width={400} height={260} />);
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(1);
  await view.rerender(<Scene play={false} width={400} height={260} />);
  expect(meteors(view)).toHaveLength(0);
  await view.rerender(<Scene width={400} height={260} />);
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(2);
});

test('Q-38 an inactive initial request waits for focus before it is consumed', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<Scene active={false} />);
  expect(timing).not.toHaveBeenCalled();
  expect(meteors(view)).toHaveLength(0);
  await view.rerender(<Scene />);
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(1);
});

test.each(['focus', 'background', 'play false', 'unmount'] as const)('P6/Q-38 %s cancels an in-flight timeline and never replays it on return', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else if (reason === 'unmount') {
    await view.unmount();
  } else {
    await view.rerender(<Scene active={reason !== 'focus'} play={reason !== 'play false'} />);
  }
  const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
  expect(stopped.length).toBeGreaterThan(0);
  const values = stopped.map((value) => value.value);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(stopped.map((value) => value.value)).toEqual(values);
  if (reason !== 'unmount') expect(meteors(view)).toHaveLength(0);
  if (reason === 'focus' || reason === 'background') {
    expectOrdinary(view);
  }
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'active'; listeners.forEach((notify) => notify('active')); });
  } else if (reason === 'focus') {
    await view.rerender(<Scene />);
  }
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(1);
});

test.each(['focus', 'background', 'play false', 'unmount'] as const)('P6/Q-38 %s cancels the reduced-motion hold and its delayed cut', async (reason) => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  expectBright(view);
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else if (reason === 'unmount') {
    await view.unmount();
  } else {
    await view.rerender(<Scene active={reason !== 'focus'} play={reason !== 'play false'} />);
  }
  expect(cancel).toHaveBeenCalled();
  const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
  const values = stopped.map((value) => value.value);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(stopped.map((value) => value.value)).toEqual(values);
  if (reason !== 'unmount') expectOrdinary(view);
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'active'; listeners.forEach((notify) => notify('active')); });
  } else if (reason === 'focus') {
    await view.rerender(<Scene />);
  }
  expect(timing).not.toHaveBeenCalled();
});

test('Q-38 switching Reduce Motion on cuts to still brightness for the remaining window and never replays meteors', async () => {
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  await view.rerender(<Scene />);
  expect(meteors(view)).toHaveLength(0);
  expectBright(view);
  expect(delay.mock.calls[0]?.[0]).toBeGreaterThan(1100);
  expect(delay.mock.calls[0]?.[0]).toBeLessThan(1300);
  await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
  expectOrdinary(view);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  await view.rerender(<Scene />);
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(0);
  expect(meteors(view).map((node) => (node.props.opacity as SharedValue<number>).get())).toEqual([0, 0, 0, 0, 0]);
});

test('Q-38 removing ShootingStars restores the retained Starfield and cancels its timed cut', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  expectBright(view);
  await view.rerender(<Starfield seed={42} width={360} height={240} active>
    <Circle cx={12} cy={12} r={2} color={dark.star} />
  </Starfield>);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expectOrdinary(view);
  expect(meteors(view)).toHaveLength(0);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expectOrdinary(view);
});

test('Q-38 switching Reduce Motion off during its hold cancels the cut without replaying meteors', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const view = await render(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  expectBright(view);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  await view.rerender(<Scene />);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(meteors(view).map((node) => (node.props.opacity as SharedValue<number>).get())).toEqual([0, 0, 0, 0, 0]);
  expect(timing.mock.calls.filter(([target]) => target === 1600)).toHaveLength(0);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expectOrdinary(view);
});
