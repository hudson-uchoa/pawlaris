import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, processColor, useColorScheme, type AppStateStatus } from 'react-native';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { insurge } from '../../tokens/color';
import { InsurgeMark } from '../insurgeMark';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.clearAllMocks();
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

test.each(['light', 'dark'] as const)('ADR-036 preserves the mark geometry, painter order and fixed brand colours in %s', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const view = await render(<InsurgeMark active={false} testID="mark" />);
  const shapes = view.container.queryAll((node) => typeof node.props.d === 'string' || node.props.r !== undefined);
  expect(shapes.map((node) => node.props.d ?? Number(node.props.r))).toEqual([
    'M3 24 A21 5 0 0 1 45 24', 12, 10.5, 'M3 24 A21 5 0 0 0 45 24',
  ]);
  const [back, ring, horizon, front] = shapes;
  expect(back?.props.strokeWidth).toBe(3.2);
  expect(back?.props.opacity).toBe(0.55);
  expect(front?.props.strokeWidth).toBe(3.2);
  expect(ring?.props.strokeWidth).toBe(3);
  expect(ring?.props.stroke).toEqual({ type: 0, payload: processColor(insurge.glow) });
  expect(horizon?.props.fill).toEqual({ type: 0, payload: processColor(insurge.void) });
  expect(shapes.every((node) => node.props.cx === undefined || Number(node.props.cx) === 24)).toBe(true);
  expect(shapes.every((node) => node.props.cy === undefined || Number(node.props.cy) === 24)).toBe(true);
  const angle = -12 * Math.PI / 180;
  const expected = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle),
    24 - 24 * Math.cos(angle) + 24 * Math.sin(angle),
    24 - 24 * Math.sin(angle) - 24 * Math.cos(angle)];
  for (const arc of [back, front]) {
    const matrix = arc?.props.matrix as number[];
    expect(matrix).toHaveLength(6);
    matrix.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0));
  }
  const gradients = view.container.queryAll((node) => node.type === 'RNSVGLinearGradient');
  expect(gradients).toHaveLength(1);
  expect(gradients[0]?.props.gradient).toEqual([
    0, Number(processColor(insurge.deep)) | 0,
    0.5, Number(processColor(insurge.violet)) | 0,
    1, Number(processColor(insurge.lavender)) | 0,
  ]);
  const gradientName = gradients[0]?.props.name as string;
  expect(back?.props.stroke).toEqual({ type: 1, brushRef: gradientName });
  expect(front?.props.stroke).toEqual({ type: 1, brushRef: gradientName });
  expect(screen.getByTestId('mark', { includeHiddenElements: true }).props.importantForAccessibility)
    .toBe('no-hide-descendants');
});

test('InsurgeMark breathes from 0.7 to 1 and back over the full 4000 ms period', async () => {
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(<InsurgeMark active={false} />);
  await view.rerender(<InsurgeMark active />);
  expect(timing).toHaveBeenCalledWith(1, { duration: 2000 });
  expect(repeat).toHaveBeenCalledTimes(1);
  expect(repeat.mock.calls[0]?.slice(1)).toEqual([-1, true]);
  // Read the real ring value exposed by cleanup when activity changed.
  const opacity = () => Number(cancel.mock.calls[0]?.[0].value);
  expect(opacity()).toBe(0.7);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(opacity()).toBeGreaterThan(0.7);
  expect(opacity()).toBeLessThan(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(1030); });
  expect(opacity()).toBeCloseTo(1, 2);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(opacity()).toBeGreaterThan(0.7);
  expect(opacity()).toBeLessThan(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(opacity()).toBeCloseTo(0.7, 2);
});

test.each(['focus', 'background', 'reduce motion', 'unmount'] as const)('P6/P9 %s cancels the breathing value', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<InsurgeMark active={false} testID="mark" />);
  await view.rerender(<InsurgeMark active testID="mark" />);
  const opacity = cancel.mock.calls[0]?.[0];
  expect(opacity?.value).toBe(0.7);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  cancel.mockClear();
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else if (reason === 'unmount') {
    await view.unmount();
  } else {
    if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    await view.rerender(<InsurgeMark active={reason !== 'focus'} testID="mark" />);
  }
  expect(cancel.mock.calls.some(([value]) => value === opacity)).toBe(true);
  const stopped = opacity?.value;
  await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
  expect(opacity?.value).toBe(stopped);
  expect(repeat).not.toHaveBeenCalled();
  if (reason !== 'unmount') expect(stopped).toBe(1);
});

test('P9 an initially reduced mark stays at alpha 1 and schedules no animation', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<InsurgeMark active />);
  expect(repeat).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
  await view.unmount();
  expect(cancel.mock.calls[0]?.[0].value).toBe(1);
});

test('InsurgeMark instances keep their gradients independent', async () => {
  const view = await render(<><InsurgeMark active={false} /><InsurgeMark active={false} /></>);
  const gradients = view.container.queryAll((node) => node.type === 'RNSVGLinearGradient');
  expect(gradients).toHaveLength(2);
  const names = gradients.map((node) => node.props.name as string);
  expect(new Set(names).size).toBe(2);
});
