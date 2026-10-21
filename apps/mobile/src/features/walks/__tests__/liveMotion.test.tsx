import { liveContext, pointAt, resetLivePlatform, seedMovingWalk, type LiveContext } from './liveSupport';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Dimensions, type AppStateStatus } from 'react-native';
import { formatDistance, formatDuration } from '../../../i18n/format';
import { ReplicaProvider } from '../../../replica/useReplica';
import { duration } from '../../../ui/motion/tokens';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import * as Theme from '../../../ui/theme';
import { dark, light } from '../../../ui/tokens/color';
import { accessibility } from '../../../ui/tokens/accessibility';
import { typography } from '../../../ui/tokens/type';
import { LiveWalkScreen } from '../LiveWalkScreen';
import { RollingDistance } from '../RollingDistance';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const digitHeight = typography.display.lineHeight
  * Math.min(Dimensions.get('window').fontScale, accessibility.maxFontSizeMultiplier);
let c: LiveContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  resetLivePlatform();
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  await c?.tracker.stop();
  c?.driver.close();
  c = undefined;
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('06 section 4.9 each changed digit rolls with a UI-thread translateY', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const interval = jest.spyOn(globalThis, 'setInterval');
  const view = await render(<RollingDistance value={formatDistance(0)} active />);
  timing.mockClear();
  await view.rerender(<RollingDistance value={formatDistance(7)} active />);
  expect(timing).toHaveBeenCalledWith(7 * digitHeight, { duration: duration.quick });
  await act(async () => { await jest.advanceTimersByTimeAsync(duration.quick + 50); });
  expect(screen.getByTestId('walk-distance-digit-3', { includeHiddenElements: true })).toHaveAnimatedStyle({
    transform: [{ translateY: -7 * digitHeight }],
  });
  expect(interval).not.toHaveBeenCalled();
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(7));
});

test.each(['light', 'dark'] as const)('06 section 5 reduced digits snap in the %s theme without timing', async (scheme) => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const color = scheme === 'light' ? light : dark;
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme, color });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<RollingDistance value={formatDistance(0)} active />);
  await view.rerender(<RollingDistance value={formatDistance(21)} active />);
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(21));
  expect(screen.getByTestId('walk-distance')).toHaveStyle({ color: color.text, opacity: 1 });
  expect(screen.queryAllByTestId(/^walk-distance-digit-/, { includeHiddenElements: true })).toHaveLength(0);
  expect(timing).not.toHaveBeenCalled();
});

test.each(['focus', 'background'] as const)('P6 rolling digits cancel and stay still after losing %s', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { listener(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const view = await render(<RollingDistance value={formatDistance(0)} active />);
  await view.rerender(<RollingDistance value={formatDistance(7)} active />);
  await act(async () => { await jest.advanceTimersByTimeAsync(50); });
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else {
    await view.rerender(<RollingDistance value={formatDistance(7)} active={false} />);
  }
  expect(cancel).toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
  await view.rerender(<RollingDistance value={formatDistance(8)} active={reason === 'background'} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(screen.getByTestId('walk-distance-digit-3', { includeHiddenElements: true })).toHaveAnimatedStyle({
    transform: [{ translateY: -8 * digitHeight }],
  });
  expect(timing).not.toHaveBeenCalled();
});

test('R4.13 06 section 4.9 the paused panel fades to sixty percent over duration.quick', async () => {
  c = await liveContext();
  await seedMovingWalk(c);
  await c.paint();
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await fireEvent.press(screen.getByTestId('walk-pause'));
  expect(timing).toHaveBeenCalledWith(0.6, { duration: duration.quick });
  await act(async () => { await jest.advanceTimersByTimeAsync(duration.quick + 50); });
  expect(screen.getByTestId('walk-metrics')).toHaveAnimatedStyle({ opacity: 0.6 });
  await fireEvent.press(screen.getByTestId('walk-resume-live'));
  await act(async () => { await jest.advanceTimersByTimeAsync(duration.quick + 50); });
  expect(screen.getByTestId('walk-metrics')).toHaveAnimatedStyle({ opacity: 1 });
});

test.each(['light', 'dark'] as const)('R4.13 reduced pause dims the panel without timing in the %s theme', async (scheme) => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const color = scheme === 'light' ? light : dark;
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme, color });
  c = await liveContext();
  await seedMovingWalk(c);
  await c.paint();
  expect(screen.getByTestId('walk-metrics')).toHaveAnimatedStyle({ opacity: 1 });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await fireEvent.press(screen.getByTestId('walk-pause'));
  await act(async () => { await jest.advanceTimersByTimeAsync(20); });
  expect(timing).not.toHaveBeenCalled();
  expect(screen.getByTestId('walk-metrics')).toHaveAnimatedStyle({ opacity: 0.6 });
});

test('R4.12 P6 losing focus stops text refresh while fixes stay durable and refocus catches up', async () => {
  c = await liveContext();
  await seedMovingWalk(c);
  const view = await c.paint();
  await view.rerender(<ReplicaProvider store={c.store}>
    <LiveWalkScreen {...c.props} active={false} />
  </ReplicaProvider>);
  await c.tick(10_000);
  await c.fix(pointAt(c, 0.002));
  expect(c.points.read(c.walk.id)).toHaveLength(3);
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(60));
  await view.rerender(<ReplicaProvider store={c.store}>
    <LiveWalkScreen {...c.props} active />
  </ReplicaProvider>);
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(70));
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(
    formatDistance(c.points.rebuild(c.walk.id).snapshot().distanceM),
  );
});
