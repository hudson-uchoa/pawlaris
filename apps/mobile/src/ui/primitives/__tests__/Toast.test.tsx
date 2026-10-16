import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { hold, spring } from '../../motion/tokens';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { Button } from '../Button';
import { ToastHost, ToastProvider, useToast } from '../Toast';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

function Triggers() {
  const toast = useToast();
  return <>
    <Button label="First" accessibilityLabel="Show first" onPress={() => { toast.show('First notice'); }} />
    <Button label="Second" accessibilityLabel="Show second" onPress={() => { toast.show('Second notice'); }} />
  </>;
}

async function scene(active = true) {
  await render(<ToastProvider dismissLabel="Dismiss notice"><Triggers /><ToastHost active={active} /></ToastProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Show first' }));
}

// Observe the actual worklet's end rather than assuming a spring duration.
async function settleEntry() {
  for (let frame = 0; frame < 240; frame += 1) {
    const style = getAnimatedStyle(screen.getByTestId('toast'));
    if (style.opacity === 1 && JSON.stringify(style.transform) === JSON.stringify([{ translateY: 0 }])) return;
    await act(async () => { await jest.advanceTimersByTimeAsync(16); });
  }
  expect(screen.getByTestId('toast')).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
}

describe.each([false, true])('P4-3 Toast motion, Reduce Motion %s', (reduced) => {
  beforeEach(() => { jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(reduced); });

  test('enters, stays for hold.toast, then sinks or fades and unmounts', async () => {
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    const animateSpring = jest.spyOn(springAnimation, 'withSpring');
    await scene();
    const toast = screen.getByTestId('toast');
    if (reduced) {
      expect(timing.mock.calls.some(([target, config]) => target === 1 && config?.duration === 150)).toBe(true);
      expect(animateSpring).not.toHaveBeenCalled();
      expect(toast).toHaveAnimatedStyle({ opacity: 0, transform: [{ translateY: 0 }] });
    } else {
      expect(animateSpring.mock.calls.find(([target]) => target === 0)?.[1]).toEqual(spring.gentle);
      expect(animateSpring.mock.calls.find(([target]) => target === 1)?.[1]).toEqual(spring.gentle);
      expect(toast).toHaveAnimatedStyle({ opacity: 0, transform: [{ translateY: 16 }] });
    }
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('polite');
    await settleEntry();
    timing.mockClear();
    expect(hold.toast).toBe(4000);
    await act(async () => { await jest.advanceTimersByTimeAsync(hold.toast - 32); });
    expect(screen.getByRole('alert')).toHaveTextContent('First notice');
    expect(timing).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(64); });
    const exitDuration = reduced ? 150 : 200;
    expect(timing.mock.calls.some(([target, config]) => target === 0 && config?.duration === exitDuration)).toBe(true);
    if (!reduced) {
      expect(timing.mock.calls.some(([target, config]) => target === 16 && config?.duration === 200)).toBe(true);
    }
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    await act(async () => { await jest.advanceTimersByTimeAsync(exitDuration + 32); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  test('the dismiss button starts the exit at once without waiting for the hold', async () => {
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    await scene();
    await settleEntry();
    timing.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss notice' }));
    const exitDuration = reduced ? 150 : 200;
    expect(timing.mock.calls.some(([target, config]) => target === 0 && config?.duration === exitDuration)).toBe(true);
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    await act(async () => { await jest.advanceTimersByTimeAsync(exitDuration + 32); });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { await jest.advanceTimersByTimeAsync(hold.toast); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test.each(['Show second', 'Show first'])('%s replaces the first and restarts its own entry and hold', async (button) => {
    await scene();
    await settleEntry();
    await act(async () => { await jest.advanceTimersByTimeAsync(hold.toast / 2); });
    await fireEvent.press(screen.getByRole('button', { name: button }));
    const expected = button === 'Show second' ? 'Second notice' : 'First notice';
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(expected);
    await settleEntry();
    await act(async () => { await jest.advanceTimersByTimeAsync(hold.toast / 2 + 64); });
    expect(screen.getByRole('alert')).toHaveTextContent(expected);
    await act(async () => { await jest.advanceTimersByTimeAsync(hold.toast / 2 + 250); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

test('P6 an inactive toast is still and starts no animation', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  await scene(false);
  expect(screen.getByRole('alert')).toBeOnTheScreen();
  expect(timing).not.toHaveBeenCalled();
  expect(animateSpring).not.toHaveBeenCalled();
});
