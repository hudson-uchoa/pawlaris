import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { State, type PanGesture } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { Sheet } from '../Sheet';
import { Text } from '../Text';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

test.each(['focus', 'background'] as const)('P6 Sheet settles and cancels its entry on loss of %s', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const onDismiss = jest.fn();
  const view = await render(<Sheet visible active accessibilityLabel="Confirm care"
    dismissLabel="Close sheet" onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else {
    await view.rerender(<Sheet visible active={false} accessibilityLabel="Confirm care"
      dismissLabel="Close sheet" onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  }
  expect(cancel).toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveAnimatedStyle({ transform: [{ translateY: 0 }] });
  const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
  const values = stopped.map((value) => value.value);
  await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
  expect(stopped.map((value) => value.value)).toEqual(values);
  expect(timing).not.toHaveBeenCalled();
  expect(spring).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
});

test('Sheet overlapping button and owner dismissals finish one exit and notify once', async () => {
  const onDismiss = jest.fn();
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<Sheet visible accessibilityLabel="Confirm care" dismissLabel="Close sheet"
    onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  timing.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Close sheet' }));
  await act(async () => { await jest.advanceTimersByTimeAsync(75); });
  await fireEvent.press(screen.getByRole('button', { name: 'Close sheet' }));
  await view.rerender(<Sheet visible={false} accessibilityLabel="Confirm care" dismissLabel="Close sheet"
    onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  expect(timing.mock.calls.filter(([target, config]) => target === 0 && config?.duration === 200)).toHaveLength(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(160); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('Sheet reopening during its owner exit cancels the old unmount', async () => {
  const onDismiss = jest.fn();
  const view = await render(<Sheet visible accessibilityLabel="Confirm care" dismissLabel="Close sheet"
    onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  await view.rerender(<Sheet visible={false} accessibilityLabel="Confirm care" dismissLabel="Close sheet"
    onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  await act(async () => { await jest.advanceTimersByTimeAsync(75); });
  await view.rerender(<Sheet visible accessibilityLabel="Confirm care" dismissLabel="Close sheet"
    onDismiss={onDismiss}><Text>Details</Text></Sheet>);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole('dialog')).toBeOnTheScreen();
  expect(onDismiss).not.toHaveBeenCalled();
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

function Confirmation({ ownerVisible = true }: { ownerVisible?: boolean }) {
  const [visible, setVisible] = useState(true);
  return <Sheet visible={ownerVisible && visible} accessibilityLabel="Confirm care"
    dismissLabel="Close sheet" onDismiss={() => { setVisible(false); }} testID="sheet">
    <Text>Care details</Text>
  </Sheet>;
}

describe.each([false, true])('P4-3 Sheet exit, Reduce Motion %s', (reduced) => {
  test.each(['drag', 'fling', 'scrim', 'back', 'button', 'owner'] as const)('%s uses the common exit and unmounts only after it finishes', async (method) => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(reduced);
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    const spring = jest.spyOn(springAnimation, 'withSpring');
    const view = await render(<Confirmation />);
    await fireEvent(screen.getByRole('dialog'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } },
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
    timing.mockClear();
    spring.mockClear();
    if (method === 'button') await fireEvent.press(screen.getByRole('button', { name: 'Close sheet' }));
    else if (method === 'scrim') await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    else if (method === 'back') await fireEvent(screen.getByTestId('sheet-modal'), 'requestClose');
    else if (method === 'owner') await view.rerender(<Confirmation ownerVisible={false} />);
    else {
      await act(() => {
        const translationY = method === 'drag' ? 100 : 0;
        const velocityY = method === 'fling' ? 1001 : 0;
        fireGestureHandler<PanGesture>(getByGestureTestId('sheet-pan'), [
          { state: State.BEGAN, translationY: 0, velocityY: 0 },
          { state: State.ACTIVE, translationY, velocityY },
          { state: State.END, translationY, velocityY },
        ]);
      });
    }
    const exitDuration = reduced ? 150 : 200;
    expect(timing.mock.calls.some(([target, config]) => target === 0 && config?.duration === exitDuration)).toBe(true);
    expect(spring).not.toHaveBeenCalled();
    if (!reduced) {
      expect(timing.mock.calls.some(([target, config]) => target === 300 && config?.duration === 200)).toBe(true);
    } else {
      expect(timing.mock.calls.every(([, config]) => config?.duration === 150)).toBe(true);
    }
    expect(screen.getByRole('dialog', { name: 'Confirm care' })).toBeOnTheScreen();
    await act(async () => { await jest.advanceTimersByTimeAsync(75); });
    expect(screen.getByRole('dialog', { name: 'Confirm care' })).toBeOnTheScreen();
    await act(async () => { await jest.advanceTimersByTimeAsync(exitDuration); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Care details')).toBeNull();
  });
});
