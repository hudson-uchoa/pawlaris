import { Camera, Layer, Map } from '@maplibre/maplibre-react-native';
import type { RoutePoint } from '@pawlaris/shared';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { duration } from '../../../ui/motion/tokens';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import * as Theme from '../../../ui/theme';
import { dark, light } from '../../../ui/tokens/color';
import { CometHead } from '../CometHead';
import { SavedRoute } from '../SavedRoute';
import { WalkMap } from '../WalkMap';
import { cometTail } from '../routeGeometry';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const route: RoutePoint[] = [[0, 0, 1000, 4], [0.001, 0, 4000, 4], [0.002, 0, 7000, 4]];
const line: [number, number][] = [[20, 20], [120, 20], [120, 120]];

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test.each(['light', 'dark'] as const)('MO-3 reduced walk motion uses a static dot and native line in %s', async (scheme) => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const color = scheme === 'light' ? light : dark;
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme, color });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await render(<WalkMap points={route} mode="live" active />);
  expect(screen.getByTestId('walk-map')).toHaveStyle({ backgroundColor: color.bg });
  expect(screen.getByTestId('walk-position')).toHaveStyle({ backgroundColor: color.star });
  expect(screen.getByTestId('walk-fix-pulse')).toHaveAnimatedStyle({ opacity: 0 });
  expect(jest.mocked(Camera).mock.lastCall?.[0]).toMatchObject({ duration: 0 });
  expect(jest.mocked(Layer).mock.calls.some(([props]) => props.id === 'walk-tail-line')).toBe(false);
  expect(timing).not.toHaveBeenCalled();
  await cleanup();
  const done = jest.fn();
  await render(<SavedRoute points={line} width={200} height={200} active onDrawn={done} />);
  expect(done).toHaveBeenCalledTimes(1);
  expect(timing).not.toHaveBeenCalled();
});

test('06 section 4.9 the fix pulse runs once per accepted fix, then cancels on blur', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<CometHead fix={1000} active />);
  expect(timing).toHaveBeenCalledWith(1, { duration: duration.burst });
  timing.mockClear();
  await view.rerender(<CometHead fix={1000} active />);
  expect(timing).not.toHaveBeenCalled();
  await view.rerender(<CometHead fix={4000} active />);
  expect(timing).toHaveBeenCalledTimes(1);
  timing.mockClear(); cancel.mockClear();
  await view.rerender(<CometHead fix={4000} active={false} />);
  expect(cancel).toHaveBeenCalled();
  expect(screen.getByTestId('walk-fix-pulse')).toHaveAnimatedStyle({ opacity: 0 });
  await view.rerender(<CometHead fix={7000} active={false} />);
  await view.rerender(<CometHead fix={7000} active />);
  expect(timing).not.toHaveBeenCalled();
});

test('06 section 4.9 live camera eases natively and switches to a jump on blur', async () => {
  const view = await render(<WalkMap points={route} mode="live" active />);
  expect(jest.mocked(Camera).mock.lastCall?.[0]).toMatchObject({
    center: [0, 0.002], duration: duration.quick, easing: 'ease',
  });
  expect(jest.mocked(Layer).mock.calls.some(([props]) => props.id === 'walk-tail-line')).toBe(true);
  await view.rerender(<WalkMap points={route} mode="live" active={false} />);
  expect(jest.mocked(Camera).mock.lastCall?.[0]).toMatchObject({ duration: 0 });
  expect(screen.getByTestId('walk-fix-pulse')).toHaveAnimatedStyle({ opacity: 0 });
});

test('06 section 4.9 the saved stroke draws once over 900 ms without a JS interval', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const interval = jest.spyOn(globalThis, 'setInterval');
  const view = await render(<WalkMap points={route} mode="detail" active />);
  expect(timing).toHaveBeenCalledWith(1, { duration: 900 }, expect.any(Function));
  // SVG extracts the initial props onto its native path. Reanimated's Jest
  // implementation advances shared values without updating that SVG host.
  expect(screen.getByTestId('walk-route-stroke').props.strokeDashoffset).toBeGreaterThan(0);
  expect(jest.mocked(Layer).mock.lastCall?.[0]).toMatchObject({ paint: { 'line-opacity': 0 } });
  const progress = cancel.mock.calls[0]?.[0];
  expect(progress?.value).toBe(0);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(progress?.value).toBe(1);
  // The completion hands the full stroke to the native map layer. No SVG
  // dash remains over it, and resizing must never replay the reveal.
  expect(screen.queryByTestId('walk-route-stroke')).toBeNull();
  expect(jest.mocked(Layer).mock.lastCall?.[0]).toMatchObject({ paint: { 'line-opacity': 1 } });
  timing.mockClear();
  await view.rerender(<WalkMap points={[...route]} mode="detail" active />);
  expect(screen.queryByTestId('walk-route-stroke')).toBeNull();
  expect(timing).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
});

test('06 section 4.9 saved draw completes on mid-draw blur and never replays on focus', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const done = jest.fn();
  const view = await render(<SavedRoute points={line} width={200} height={200} active onDrawn={done} />);
  expect(timing).toHaveBeenCalledTimes(1);
  const progress = cancel.mock.calls[0]?.[0];
  await act(async () => { await jest.advanceTimersByTimeAsync(duration.walkRoute / 2); });
  expect(progress?.value).toBeGreaterThan(0);
  expect(progress?.value).toBeLessThan(1);
  expect(done).not.toHaveBeenCalled();
  timing.mockClear(); cancel.mockClear();
  await view.rerender(<SavedRoute points={line} width={200} height={200} active={false} onDrawn={done} />);
  expect(cancel).toHaveBeenCalledWith(progress);
  expect(progress?.value).toBe(1);
  expect(done).toHaveBeenCalledTimes(1);
  expect(timing).not.toHaveBeenCalled();
  await view.rerender(<SavedRoute points={line} width={200} height={200} active onDrawn={done} />);
  expect(progress?.value).toBe(1);
  expect(timing).not.toHaveBeenCalled();
});

test('06 section 4.9 saved draw mounted out of focus is complete without timing', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const done = jest.fn();
  const view = await render(<SavedRoute points={line} width={200} height={200} active={false} onDrawn={done} />);
  expect(timing).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0]?.[0].value).toBe(1);
  await view.rerender(<SavedRoute points={line} width={200} height={200} active onDrawn={done} />);
  expect(timing).not.toHaveBeenCalled();
});

test.each(['focus', 'background'] as const)('P6 saved draw, comet and camera stop after losing %s', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus): void => { listener(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const view = await render(<ViewMaps active />);
  jest.mocked(Camera).mockClear();
  jest.mocked(Map).mockClear();
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  if (reason === 'background') {
    await act(() => {
      AppState.currentState = 'background'; listeners.forEach((notify) => { notify('background'); });
    });
  } else await view.rerender(<ViewMaps active={false} />);
  expect(cancel).toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
  expect(jest.mocked(Camera).mock.calls.every(([props]) => props.duration === 0)).toBe(true);
  expect(jest.mocked(Map).mock.calls.every(([props]) => props.dragPan === false)).toBe(true);
});

function ViewMaps({ active }: { active: boolean }) {
  return <><WalkMap points={route} mode="live" active={active} />
    <WalkMap points={route} mode="detail" active={active} /></>;
}

test('06 section 4.9 the comet tail clips to forty metres on the route', () => {
  const tail = cometTail(route);
  expect(tail).toHaveLength(2);
  expect(tail.at(-1)).toEqual([0, 0.002]);
  const start = tail[0];
  expect(start?.[1]).toBeCloseTo(0.002 - 40 / 111_194.9266, 8);
});
