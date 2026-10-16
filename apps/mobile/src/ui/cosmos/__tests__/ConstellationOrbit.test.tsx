import { identityIndexForId } from '@pawlaris/shared';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, processColor, useColorScheme, type AppStateStatus } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { Text } from '../../primitives/Text';
import { dark, identity, light } from '../../tokens/color';
import { ConstellationLine } from '../ConstellationLine';
import { Orbit } from '../Orbit';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const points = [{ x: 12, y: 12 }, { x: 42, y: 52 }, { x: 102, y: 52 }];

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

test.each(['light', 'dark'] as const)('ConstellationLine joins points in order with a themed thin gold stroke in %s', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const color = scheme === 'light' ? light : dark;
  const view = await render(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  const paths = view.container.queryAll((node) => typeof node.props.d === 'string');
  expect(paths).toHaveLength(1);
  expect(paths[0]?.props.d).toBe('M12 12 L42 52 L102 52');
  expect(paths[0]?.props.stroke).toEqual({ type: 0, payload: processColor(color.star) });
  expect(paths[0]?.props.strokeWidth).toBe(1.75);
  expect(paths[0]?.props.strokeDasharray).toEqual([110, 110]);
  expect(screen.getByTestId('line', { includeHiddenElements: true }).props.importantForAccessibility)
    .toBe('no-hide-descendants');
});

test('ConstellationLine draws on over 280 ms, stays while complete and disappears on undo', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<ConstellationLine points={points} width={120} height={64} complete={false} active testID="line" />);
  expect(screen.queryByTestId('line', { includeHiddenElements: true })).toBeNull();
  expect(timing).not.toHaveBeenCalled();
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledWith(0, { duration: 280 });
  // The real cleanup exposes the same shared offset now being animated.
  // SVG's host props are a snapshot; its animated updates live on the UI thread.
  const offset = () => cancel.mock.calls[0]?.[0].value;
  expect(offset()).toBe(110);
  await act(async () => { await jest.advanceTimersByTimeAsync(140); });
  expect(offset()).toBeGreaterThan(0);
  expect(offset()).toBeLessThan(110);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(offset()).toBe(0);
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  expect(timing).toHaveBeenCalledTimes(1);
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete={false} active testID="line" />);
  expect(screen.queryByTestId('line', { includeHiddenElements: true })).toBeNull();
});

test('R1 ConstellationLine mounts complete and active with a finished still line', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  expect(screen.getByTestId('line', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(timing).not.toHaveBeenCalled();
  await view.unmount();
  expect(cancel.mock.calls[0]?.[0].value).toBe(0);
});

test.each(['focus', 'background'] as const)('R1 ConstellationLine completes while inactive and returns from %s without drawing on', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<ConstellationLine points={points} width={120} height={64} complete={false} active testID="line" />);
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  }
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete={false} active={reason !== 'focus'} testID="line" />);
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete active={reason !== 'focus'} testID="line" />);
  expect(timing).not.toHaveBeenCalled();
  expect(cancel.mock.calls[0]?.[0].value).toBe(0);
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'active'; listeners.forEach((notify) => notify('active')); });
  }
  await view.rerender(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  expect(screen.getByTestId('line', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(timing).not.toHaveBeenCalled();
  expect(cancel.mock.calls[0]?.[0].value).toBe(0);
});

test('P9 ConstellationLine appears complete without scheduling motion under Reduce Motion', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<ConstellationLine points={points} width={120} height={64} complete active testID="line" />);
  expect(timing).not.toHaveBeenCalled();
  expect(screen.getByTestId('line', { includeHiddenElements: true })).toBeOnTheScreen();
  await view.unmount();
  expect(cancel.mock.calls[0]?.[0].value).toBe(0);
});

test.each(['light', 'dark'] as const)('Orbit preserves avatar semantics and uses the pet identity in %s', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const entry = identity[identityIndexForId('pet-a')] ?? identity[0];
  const view = await render(<Orbit petId="pet-a" size={96} active={false} satellite testID="orbit">
    <Text accessibilityRole="image" accessibilityLabel="Pet portrait">Portrait</Text>
  </Orbit>);
  expect(screen.getByRole('image', { name: 'Pet portrait' })).toBeOnTheScreen();
  const rings = view.container.queryAll((node) => node.props.r !== undefined);
  expect(rings).toHaveLength(1);
  expect(rings[0]?.props.r).toBe(47.25);
  expect(rings[0]?.props.strokeWidth).toBe(1.5);
  expect(rings[0]?.props.stroke).toEqual({ type: 0, payload: processColor(entry[scheme]) });
  expect(screen.getByTestId('orbit-satellite', { includeHiddenElements: true }))
    .toHaveStyle({ width: 4, height: 4, backgroundColor: entry[scheme] });
});

test('Orbit completes one clockwise revolution every 24000 ms on a circular path', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await render(<Orbit petId="pet-a" size={96} active satellite testID="orbit" />);
  expect(timing.mock.calls).toEqual([[2 * Math.PI, expect.objectContaining({ duration: 24000 })]]);
  const dot = screen.getByTestId('orbit-satellite', { includeHiddenElements: true });
  expect(dot).toHaveAnimatedStyle({ transform: [{ translateX: Math.cos(-Math.PI / 2) * 47.25 }, { translateY: -47.25 }] });
  await act(async () => { await jest.advanceTimersByTimeAsync(6000); });
  const quarterTurn = getAnimatedStyle(dot).transform as [{ translateX: number }, { translateY: number }];
  expect(quarterTurn[0].translateX).toBeCloseTo(47.25, 0);
  expect(quarterTurn[1].translateY).toBeCloseTo(0, 0);
});

test('P9 Orbit renders a static ring without a satellite under Reduce Motion', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(<Orbit petId="pet-a" size={96} active satellite testID="orbit" />);
  expect(repeat).not.toHaveBeenCalled();
  expect(view.container.queryAll((node) => node.props.r !== undefined)).toHaveLength(1);
  expect(screen.queryByTestId('orbit-satellite', { includeHiddenElements: true })).toBeNull();
});

test.each(['focus', 'background', 'reduce motion'] as const)('P6/P9 %s stops the orbit and constellation shared values', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  function Scene({ active }: { active: boolean }) {
    return <>
      <ConstellationLine points={points} width={120} height={64} complete active={active} />
      <Orbit petId="pet-a" size={96} active={active} satellite testID="orbit" />
    </>;
  }
  const view = await render(<Scene active />);
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else {
    if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    await view.rerender(<Scene active={reason !== 'focus'} />);
  }
  const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
  expect(stopped).toHaveLength(2);
  const values = stopped.map((value) => value.value);
  await act(async () => { await jest.advanceTimersByTimeAsync(48000); });
  expect(stopped.map((value) => value.value)).toEqual(values);
  expect(repeat).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
});
