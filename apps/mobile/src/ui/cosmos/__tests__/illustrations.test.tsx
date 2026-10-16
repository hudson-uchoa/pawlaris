import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { dark } from '../../tokens/color';
import { ClearSky } from '../illustrations/ClearSky';
import { EmptyHealth } from '../illustrations/EmptyHealth';
import { EmptyPets } from '../illustrations/EmptyPets';
import { EmptyWalks } from '../illustrations/EmptyWalks';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const scenes = [
  ['ClearSky', ClearSky], ['EmptyPets', EmptyPets], ['EmptyWalks', EmptyWalks], ['EmptyHealth', EmptyHealth],
] as const;

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

test('ClearSky draws a crescent and a few gold stars', async () => {
  const view = await render(<ClearSky width={240} height={160} active={false} />);
  const paths = view.container.queryAll((node) => node.type === 'skPath');
  const moons = paths.filter((node) => node.props.color === dark.textMuted);
  expect(moons).toHaveLength(1);
  expect((moons[0]?.props.path as string).match(/ A/g)).toHaveLength(2);
  expect(paths.filter((node) => node.props.color === dark.star)).toHaveLength(3);
});

test('EmptyPets draws a dotted paw with four toes, all unlit', async () => {
  const view = await render(<EmptyPets width={240} height={160} active={false} />);
  const pads = view.container.queryAll((node) => node.type === 'skPath');
  const toes = view.container.queryAll((node) => node.type === 'skCircle');
  expect(pads).toHaveLength(1);
  expect(toes).toHaveLength(4);
  for (const shape of [...pads, ...toes]) {
    expect(shape.props.style).toBe('stroke');
    expect(shape.props.color).toBe(dark.textMuted);
    expect(shape.children).toHaveLength(1);
    expect(shape.children[0]).toEqual(expect.objectContaining({ type: 'skDashPathEffect' }));
  }
  expect(view.container.queryAll((node) => node.props.color === dark.star)).toHaveLength(0);
});

test('EmptyWalks places a ring behind and in front of a planet within a dashed orbit', async () => {
  const view = await render(<EmptyWalks width={240} height={160} active={false} />);
  const orbit = view.container.queryAll((node) => node.type === 'skOval');
  expect(orbit).toHaveLength(1);
  expect(orbit[0]?.props.style).toBe('stroke');
  expect(orbit[0]?.children[0]).toEqual(expect.objectContaining({ type: 'skDashPathEffect' }));
  const shapes = view.container.queryAll((node) => node.type === 'skPath' || node.type === 'skCircle');
  expect(shapes.map((shape) => [shape.type, shape.props.color])).toEqual([
    ['skPath', dark.accent], ['skCircle', dark.accentSoft], ['skCircle', dark.accent], ['skPath', dark.accent],
  ]);
});

test('EmptyHealth draws one gold star above a horizontal horizon', async () => {
  const view = await render(<EmptyHealth width={240} height={160} active={false} />);
  const stars = view.container.queryAll((node) => node.type === 'skPath');
  const horizons = view.container.queryAll((node) => node.type === 'skLine');
  expect(stars).toHaveLength(1);
  expect(horizons).toHaveLength(1);
  expect(stars[0]?.props.color).toBe(dark.star);
  const from = horizons[0]?.props.p1 as { x: number; y: number };
  const to = horizons[0]?.props.p2 as { x: number; y: number };
  expect(from.y).toBe(to.y);
  expect(to.x).toBeGreaterThan(from.x);
  const vertices = [...(stars[0]?.props.path as string).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)];
  expect(vertices).toHaveLength(10);
  expect(Math.max(...vertices.map((vertex) => Number(vertex[2])))).toBeLessThan(from.y);
});

describe.each(scenes)('%s activity', (_name, Illustration) => {
  test.each(['focus', 'background', 'reduce motion'] as const)('P6/P9 %s cancels twinkle and preserves the still scene', async (reason) => {
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
      listeners.add(notify);
      return { remove: () => { listeners.delete(notify); } };
    });
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const view = await render(<Illustration width={240} height={160} active testID="scene" />);
    expect(repeat).toHaveBeenCalledTimes(3);
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    repeat.mockClear();
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    if (reason === 'background') {
      await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
    } else {
      if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
      await view.rerender(<Illustration width={240} height={160} active={reason !== 'focus'} testID="scene" />);
    }
    const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
    expect(stopped).toHaveLength(3);
    const values = stopped.map((value) => value.value);
    await act(async () => { await jest.advanceTimersByTimeAsync(10600); });
    expect(stopped.map((value) => value.value)).toEqual(values);
    expect(repeat).not.toHaveBeenCalled();
    expect(screen.getByTestId('scene', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('scene', { includeHiddenElements: true }).props.importantForAccessibility)
      .toBe('no-hide-descendants');
    expect(view.container.queryAll((node) => node.type === 'skPoints')).toHaveLength(3);
    expect(view.container.queryAll((node) => ['skPath', 'skCircle', 'skOval', 'skLine'].includes(node.type)).length)
      .toBeGreaterThan(0);
  });
});
