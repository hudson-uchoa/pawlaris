import { act, cleanup, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, processColor, useColorScheme, type AppStateStatus } from 'react-native';
import { State, type PanGesture } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { fakeClock } from '../../../testing/fakeClock';
import { rowFactories } from '../../../testing/rowFactories';
import { sequentialIds } from '../../../testing/sequentialIds';
import { duration } from '../../../ui/motion/tokens';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { dark, light } from '../../../ui/tokens/color';
import { WeightChart } from '../WeightChart';
import { weightChartGeometry } from '../weightChartPath';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const factory = rowFactories(fakeClock(Date.UTC(2026, 9, 3)), sequentialIds());
const entries = [2, 4.25, 3].map((weight_kg, index) => factory.weight_entries({
  weight_kg, measured_at: `2026-10-0${index + 2}T01:00:00Z`,
}));
const props = { entries, width: 300, height: 180, timezone: 'America/Sao_Paulo', active: true };

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test.each(['light', 'dark'] as const)('R2.6 reduced chart draws the line, stars and gradient immediately in %s', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  jest.mocked(ReduceMotion.useReduceMotion).mockReturnValue(true);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const color = scheme === 'dark' ? dark : light;
  const view = await render(<WeightChart {...props} />);
  const geometry = weightChartGeometry(entries, 300, 180);
  expect(screen.getByTestId('weight-chart-line').props.d).toBe(geometry.path);
  expect(screen.getByTestId('weight-chart-line').props.stroke).toEqual({ type: 0, payload: processColor(color.accent) });
  // react-native-svg extracts a zero dash offset as null (the native default).
  expect(screen.getByTestId('weight-chart-line').props.strokeDashoffset ?? 0).toBe(0);
  expect(screen.getAllByTestId(/^weight-chart-star-/).map((star) => star.props.opacity)).toEqual([1, 1, 1]);
  const gradients = view.container.queryAll((node) => Array.isArray(node.props.gradient));
  const rgb = Number(processColor(color.accentSoft)) & 0x00ffffff;
  expect(gradients[0]?.props.gradient).toEqual([0, rgb | (255 << 24), 1, rgb]);
  expect(timing).not.toHaveBeenCalled();
});

test('R2.6 the first appearance draws for 600 ms with stars following the head and does not replay', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<WeightChart {...props} />);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: duration.weightChart }));
  expect(screen.getAllByTestId(/^weight-chart-star-/).map((star) => star.props.opacity)).toEqual([1, 0, 0]);
  const progress = cancel.mock.calls[0]?.[0];
  expect(progress?.value).toBe(0);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(progress?.value).toBeGreaterThan(0);
  expect(progress?.value).toBeLessThan(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  expect(progress?.value).toBe(1);
  await view.rerender(<WeightChart {...props} entries={[...entries]} />);
  expect(timing).toHaveBeenCalledTimes(1);
});

test.each(['focus', 'background'] as const)('R2.6 losing %s cancels draw-on and returns to a still chart', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (state: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<WeightChart {...props} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  const progress = cancel.mock.calls[0]?.[0];
  if (reason === 'focus') await view.rerender(<WeightChart {...props} active={false} />);
  else await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  expect(progress?.value).toBe(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(progress?.value).toBe(1);
  await act(() => { AppState.currentState = 'active'; listeners.forEach((notify) => notify('active')); });
  await view.rerender(<WeightChart {...props} />);
  expect(timing).toHaveBeenCalledTimes(1);
});

test('R2.6 scrub snaps to the nearest measurement with one light haptic per change and a family-time label', async () => {
  jest.mocked(ReduceMotion.useReduceMotion).mockReturnValue(true);
  const view = await render(<WeightChart {...props} />);
  await act(async () => {
    fireGestureHandler<PanGesture>(getByGestureTestId('weight-chart-pan'), [
      { state: State.BEGAN, x: 0 }, { state: State.ACTIVE, x: 140 },
      { state: State.ACTIVE, x: 155 }, { state: State.ACTIVE, x: 280 },
      { state: State.ACTIVE, x: 160 }, { state: State.END, x: 160 },
    ]);
    await jest.advanceTimersByTimeAsync(0);
  });
  // 03/10 at 01:00 UTC is still 02/10 in the family's timezone.
  expect(screen.getByTestId('weight-chart-value')).toHaveTextContent('4,25 kg · 02/10');
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(3);
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  await view.rerender(<WeightChart {...props} active={false} />);
  expect(screen.getByTestId('weight-chart-value')).toHaveTextContent('');
});
