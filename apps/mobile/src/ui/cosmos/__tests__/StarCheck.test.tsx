import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, StyleSheet, processColor, useColorScheme, type AppStateStatus, type ViewStyle } from 'react-native';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { dark, light } from '../../tokens/color';
import { pairs } from '../../tokens/pairs';
import { StarCheck } from '../StarCheck';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const initialAppState = AppState.currentState;

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

test.each(['light', 'dark'] as const)('R7.5 StarCheck uses the %s ring, fill and star tokens', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const color = scheme === 'light' ? light : dark;
  const view = await render(<StarCheck active checked accessibilityLabel="Scheduled care" onPress={jest.fn()} />);
  expect(view.container.queryAll((node) => StyleSheet.flatten<ViewStyle>(node.props.style)?.borderColor === color.textMuted))
    .toHaveLength(1);
  expect(view.container.queryAll((node) => StyleSheet.flatten<ViewStyle>(node.props.style)?.backgroundColor === color.accentSoft))
    .toHaveLength(1);
  const paths = view.container.queryAll((node) => typeof node.props.d === 'string');
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) expect(path.props.fill).toEqual({ type: 0, payload: processColor(color.star) });
});

test('StarCheck restores a checked record without an ignition or haptic', async () => {
  const spring = jest.spyOn(springAnimation, 'withSpring');
  await render(<StarCheck active checked accessibilityLabel="Scheduled care" testID="care" onPress={jest.fn()} />);
  expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
  expect(screen.getByTestId('care-star', { includeHiddenElements: true }))
    .toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
  expect(spring).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Q-37 StarCheck uses the %s outline treatment without changing the gold fill', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const color = scheme === 'light' ? light : dark;
  const view = await render(<StarCheck active checked accessibilityLabel="Scheduled care" onPress={jest.fn()} />);
  const paths = view.container.queryAll((node) => typeof node.props.d === 'string');
  const litStar = paths[0];
  expect(litStar).toBeDefined();
  expect(litStar?.props.fill).toEqual({ type: 0, payload: processColor(color.star) });
  if (scheme === 'light') {
    expect(litStar?.props.stroke).toEqual({ type: 0, payload: processColor(color.starText) });
    expect(litStar?.props.strokeWidth).toBe(1.75);
    expect(pairs).toContainEqual({
      name: 'starText/accentSoft/graphic', foreground: 'starText', background: 'accentSoft', kind: 'graphic',
    });
  } else {
    expect(litStar?.props.stroke).toBeUndefined();
  }
});

test('StarCheck stays lit through a checked rerender and animates undo without another haptic', async () => {
  const onPress = jest.fn();
  const view = await render(<StarCheck active checked={false} accessibilityLabel="Scheduled care" testID="care" onPress={onPress} />);
  await fireEvent.press(screen.getByRole('checkbox'));
  expect(onPress).toHaveBeenCalledTimes(1);
  await view.rerender(<StarCheck active checked accessibilityLabel="Scheduled care" testID="care" onPress={onPress} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  const spring = jest.spyOn(springAnimation, 'withSpring');
  await view.rerender(<StarCheck active checked accessibilityLabel="Care completed by another member" testID="care" onPress={onPress} />);
  expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
  expect(screen.getByTestId('care-star', { includeHiddenElements: true }))
    .toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
  expect(spring).not.toHaveBeenCalled();
  await view.rerender(<StarCheck active checked={false} accessibilityLabel="Scheduled care" testID="care" onPress={onPress} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(screen.getByTestId('care-star', { includeHiddenElements: true }))
    .toHaveAnimatedStyle({ opacity: 0, transform: [{ scale: 0 }] });
  expect(screen.queryByTestId('care-sparks', { includeHiddenElements: true })).toBeNull();
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
});

test.each(['focus', 'background', 'reduce motion'] as const)('P6/P9 %s cancels ignition and removes sparks', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const onPress = jest.fn();
  const view = await render(<StarCheck active checked={false} accessibilityLabel="Scheduled care" testID="care" onPress={onPress} />);
  await fireEvent.press(screen.getByRole('checkbox'));
  await view.rerender(<StarCheck active checked accessibilityLabel="Scheduled care" testID="care" onPress={onPress} />);
  expect(screen.getByTestId('care-sparks', { includeHiddenElements: true })).toBeOnTheScreen();
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; [...listeners].forEach((notify) => notify('background')); });
  } else {
    if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    await view.rerender(<StarCheck active={reason !== 'focus'} checked accessibilityLabel="Scheduled care" testID="care" onPress={onPress} />);
  }
  expect(cancel).toHaveBeenCalled();
  expect(screen.queryByTestId('care-sparks', { includeHiddenElements: true })).toBeNull();
  const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
  const values = stopped.map((value) => value.value);
  await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
  expect(stopped.map((value) => value.value)).toEqual(values);
  expect(screen.getByTestId('care-star', { includeHiddenElements: true }))
    .toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
});
