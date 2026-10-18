import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { spring } from '../../../ui/motion/tokens';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { TabIcon, type TabName } from '../TabIcon';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const names: TabName[] = ['index', 'pets', 'walks', 'settings'];

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

function star(name: TabName = 'pets') {
  return screen.getByTestId(`tab-${name}-star`, { includeHiddenElements: true });
}

describe.each(['light', 'dark'] as const)('TabIcon in %s', (scheme) => {
  test.each(names)('%s scales its star in with the bouncy spring when selected', async (name) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const animate = jest.spyOn(springAnimation, 'withSpring');
    const view = await render(<TabIcon name={name} focused={false} active />);
    expect(star(name)).toHaveAnimatedStyle({ transform: [{ scale: 0 }] });
    expect(animate).not.toHaveBeenCalled();
    const initial = getAnimatedStyle(star(name));
    await view.rerender(<TabIcon name={name} focused active />);
    expect(animate).toHaveBeenCalledWith(1, spring.bouncy);
    await act(async () => { await jest.advanceTimersByTimeAsync(64); });
    expect(getAnimatedStyle(star(name))).not.toEqual(initial);
    await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
    expect(star(name)).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
    await view.rerender(<TabIcon name={name} focused={false} active />);
    expect(star(name)).toHaveAnimatedStyle({ transform: [{ scale: 0 }] });
  });
});

test('P9 TabIcon selection is still under Reduce Motion', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const animate = jest.spyOn(springAnimation, 'withSpring');
  const view = await render(<TabIcon name="pets" focused={false} active />);
  await view.rerender(<TabIcon name="pets" focused active />);
  await act(async () => { await jest.advanceTimersByTimeAsync(16); });
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  expect(animate).not.toHaveBeenCalled();
});

test('TabIcon mounted selected shows its finished star without an entrance', async () => {
  const animate = jest.spyOn(springAnimation, 'withSpring');
  await render(<TabIcon name="pets" focused active />);
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  expect(animate).not.toHaveBeenCalled();
});

test('P6 TabIcon selected while inactive remains still on return to activity', async () => {
  const animate = jest.spyOn(springAnimation, 'withSpring');
  const view = await render(<TabIcon name="pets" focused={false} active={false} />);
  await view.rerender(<TabIcon name="pets" focused active={false} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(16); });
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  await view.rerender(<TabIcon name="pets" focused active />);
  await act(async () => { await jest.advanceTimersByTimeAsync(16); });
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  expect(animate).not.toHaveBeenCalled();
});

test.each(['focus', 'background'] as const)('P6 TabIcon cancels its spring on loss of %s', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const view = await render(<TabIcon name="pets" focused={false} active />);
  await view.rerender(<TabIcon name="pets" focused active />);
  await act(async () => { await jest.advanceTimersByTimeAsync(64); });
  const animate = jest.spyOn(springAnimation, 'withSpring');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else {
    await view.rerender(<TabIcon name="pets" focused active={false} />);
  }
  expect(cancel).toHaveBeenCalled();
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(star()).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  expect(animate).not.toHaveBeenCalled();
});
