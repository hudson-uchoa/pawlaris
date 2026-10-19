import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Dimensions, Pressable, Text, View } from 'react-native';
import Animated, { measure } from 'react-native-reanimated';
import { duration, spring } from '../../tokens';
import * as ReduceMotion from '../../useReduceMotion';
import { HeroProvider, useHeroSource, useHeroTarget } from '..';

jest.mock('react-native-reanimated', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native-reanimated')),
  measure: { value: jest.fn(), configurable: true, enumerable: true },
}));

type AnimationAPI = typeof import('react-native-reanimated');
type ThreadsAPI = typeof import('react-native-worklets');
const threadsEntry = jest.requireActual<{ main: string }>('react-native-worklets/package.json').main;
const threadsRoot = `react-native-worklets/${threadsEntry.replace(/\/index(?:\.js)?$/, '')}`;
const threads = jest.requireActual<Pick<ThreadsAPI, 'scheduleOnUI' | 'scheduleOnRN'>>(`${threadsRoot}/threads`);
type Frame = NonNullable<ReturnType<AnimationAPI['measure']>>;
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const measurement = { measure: jest.mocked(measure) };
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const frames = new Map<unknown, Frame | null>();
const initialAppState = AppState.currentState;

function frame(pageX: number, pageY: number, width: number, height: number): Frame {
  return { x: 0, y: 0, pageX, pageY, width, height };
}

function Target({ nullMeasure, onBack, active }: { nullMeasure: boolean; onBack(): void; active: boolean }) {
  const target = useHeroTarget('pet-1', active);
  frames.set(target.avatar.ref, nullMeasure ? null : frame(100, 60, 128, 128));
  frames.set(target.name.ref, frame(120, 210, 100, 32));
  return <>
    <Animated.View testID="target-avatar" {...target.avatar}><View /></Animated.View>
    <Animated.View testID="target-name" {...target.name}><Text>Pet</Text></Animated.View>
    <Animated.View testID="target-body" style={target.contentStyle} />
    <Pressable testID="back" onPress={() => { target.back(onBack); }} />
  </>;
}

function Source({ nullMeasure, onNavigate }: {
  nullMeasure: 'source' | 'target' | null;
  onNavigate(): void;
}) {
  const source = useHeroSource('pet-1');
  const content = { avatar: <View testID="avatar-copy" />, name: <Text testID="name-copy">Pet</Text> };
  frames.set(source.avatar.ref, nullMeasure === 'source' ? null : frame(20, 80, 64, 64));
  frames.set(source.name.ref, frame(30, 160, 80, 24));
  return <Pressable testID="open-profile" onPress={() => { source.start(content, onNavigate); }}>
      <Animated.View testID="source-avatar" {...source.avatar}><View /></Animated.View>
      <Animated.View testID="source-name" {...source.name}><Text>Pet</Text></Animated.View>
    </Pressable>;
}

function Navigator({ nullMeasure, onNavigate, sourcePresent = true, targetActive = true }: {
  nullMeasure: 'source' | 'target' | null;
  onNavigate(): void;
  sourcePresent?: boolean;
  targetActive?: boolean;
}) {
  const [profile, setProfile] = useState(false);
  return <>
    {sourcePresent && <Source nullMeasure={nullMeasure} onNavigate={() => { onNavigate(); setProfile(true); }} />}
    {profile && <Target nullMeasure={nullMeasure === 'target'} active={targetActive} onBack={() => { setProfile(false); }} />}
  </>;
}

async function navigate(nullMeasure: 'source' | 'target' | null = null) {
  const onNavigate = jest.fn();
  const view = await render(<HeroProvider active><Navigator nullMeasure={nullMeasure} onNavigate={onNavigate} /></HeroProvider>);
  await fireEvent.press(screen.getByTestId('open-profile'));
  expect(onNavigate).toHaveBeenCalledTimes(1);
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 128, height: 128 } } };
  await fireEvent(screen.getByTestId('target-avatar', { includeHiddenElements: true }), 'layout', layout);
  await fireEvent(screen.getByTestId('target-name', { includeHiddenElements: true }), 'layout', layout);
  return { view, onNavigate };
}

async function advance(milliseconds: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  // Jest has no separate UI runtime. Deliver thread handoffs immediately;
  // Reanimated still drives each spring/timing animation frame by frame.
  jest.spyOn(threads, 'scheduleOnUI').mockImplementation((worklet, ...args) => { worklet(...args); });
  jest.spyOn(threads, 'scheduleOnRN').mockImplementation((callback, ...args) => { callback(...args); });
  AppState.currentState = 'active';
  frames.clear();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  measurement.measure.mockReset().mockImplementation((ref) => frames.get(ref) ?? null);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('MO-1: Reduce Motion takes the 150 ms crossfade path without scheduling a spring', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await navigate();
  expect(timing.mock.calls.some(([value, config]) => value === 1 && config?.duration === duration.reducedFade)).toBe(true);
  await advance(duration.reducedFade + 32);
  expect(screen.getByTestId('target-body')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('target-avatar')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('target-name')).toHaveAnimatedStyle({ opacity: 1 });
  expect(animateSpring).not.toHaveBeenCalled();
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
});

test.each([
  'null source',
  'null target',
  'zero-width source avatar',
  'off-screen source avatar on Back',
  'null name with a valid avatar',
] as const)('P4-8: measuring %s takes the crossfade path', async (failure) => {
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  if (failure === 'zero-width source avatar') {
    measurement.measure.mockImplementationOnce(() => frame(20, 80, 0, 64));
  } else if (failure === 'null name with a valid avatar') {
    measurement.measure.mockImplementationOnce(() => frame(20, 80, 64, 64))
      .mockImplementationOnce(() => null);
  }
  await navigate(failure === 'null source' ? 'source' : failure === 'null target' ? 'target' : null);
  const back = failure === 'off-screen source avatar on Back';
  if (back) {
    const sourceAvatar = measurement.measure.mock.calls[0]?.[0];
    expect(sourceAvatar).toBeDefined();
    await advance(2000);
    frames.set(sourceAvatar, frame(20, Dimensions.get('window').height + 1, 64, 64));
    measurement.measure.mockClear();
    animateSpring.mockClear();
    timing.mockClear();
    await fireEvent.press(screen.getByTestId('back'));
    expect(measurement.measure.mock.calls).toContainEqual([sourceAvatar]);
    expect(screen.getByTestId('hero-overlay', { includeHiddenElements: true })).toBeOnTheScreen();
  }
  expect(measurement.measure).toHaveBeenCalled();
  expect(animateSpring).not.toHaveBeenCalled();
  // Q-45: measurement failures use the same fade duration as Reduce Motion.
  expect(timing.mock.calls.some(([value, config]) => value === (back ? 0 : 1) && config?.duration === duration.reducedFade)).toBe(true);
  await advance(duration.reducedFade + 32);
  if (back) {
    expect(screen.queryByTestId('target-avatar', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('source-avatar')).toHaveAnimatedStyle({ opacity: 1 });
    expect(screen.getByTestId('source-name')).toHaveAnimatedStyle({ opacity: 1 });
  } else {
    expect(screen.getByTestId('target-body')).toHaveAnimatedStyle({ opacity: 1 });
    expect(screen.getByTestId('target-avatar')).toHaveAnimatedStyle({ opacity: 1 });
  }
  expect(animateSpring).not.toHaveBeenCalled();
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('avatar-copy', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('name-copy', { includeHiddenElements: true })).toBeNull();
});

test('P4-8: the overlay unmounts after the spring settles with no leaked view', async () => {
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  await navigate();
  const overlay = screen.getByTestId('hero-overlay', { includeHiddenElements: true });
  expect(overlay).toBeOnTheScreen();
  expect(screen.getByTestId('avatar-copy', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByTestId('name-copy', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByTestId('source-avatar', { includeHiddenElements: true })).toHaveAnimatedStyle({ opacity: 0 });
  expect(screen.getByTestId('target-avatar', { includeHiddenElements: true })).toHaveAnimatedStyle({ opacity: 0 });
  expect(animateSpring.mock.calls.some(([, config]) => JSON.stringify(config) === JSON.stringify(spring.snappy))).toBe(true);
  // Observe completion frame by frame; spring settling has no fixed duration.
  for (let tick = 0; tick < 240 && screen.queryByTestId('hero-overlay', { includeHiddenElements: true }) !== null; tick += 1) {
    await advance(16);
  }
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(overlay).not.toBeOnTheScreen();
  expect(screen.queryByTestId('avatar-copy', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('name-copy', { includeHiddenElements: true })).toBeNull();
  for (const id of ['source-avatar', 'source-name', 'target-avatar', 'target-name', 'target-body']) {
    expect(screen.getByTestId(id, { includeHiddenElements: true })).toHaveAnimatedStyle({ opacity: 1 });
  }
  await advance(duration.hero * 2);
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
});

test('P4-8: Back re-measures the moved source and scales the header copies to its window frames', async () => {
  await navigate();
  const sourceAvatar = measurement.measure.mock.calls[0]?.[0];
  expect(sourceAvatar).toBeDefined();
  await advance(2000);
  frames.set(sourceAvatar, frame(40, 350, 64, 64));
  measurement.measure.mockClear();
  await fireEvent.press(screen.getByTestId('back'));
  expect(measurement.measure.mock.calls).toContainEqual([sourceAvatar]);
  const avatar = screen.getByTestId('hero-overlay-avatar', { includeHiddenElements: true });
  const name = screen.getByTestId('hero-overlay-name', { includeHiddenElements: true });
  expect(avatar).toHaveAnimatedStyle({ left: 100, top: 60, width: 64, height: 64,
    transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 2 }, { scaleY: 2 }] });
  await advance(2000);
  expect(avatar).toHaveAnimatedStyle({ transform: [
    { translateX: -60 }, { translateY: 290 }, { scaleX: 1 }, { scaleY: 1 },
  ] });
  expect(name).toHaveAnimatedStyle({ transform: [
    { translateX: -90 }, { translateY: -50 }, { scaleX: 1 }, { scaleY: 1 },
  ] });
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('target-avatar', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('source-avatar')).toHaveAnimatedStyle({ opacity: 1 });
});

test('P4-8: Back with an unmounted source uses the Q-45 crossfade and cleans up', async () => {
  const { view, onNavigate } = await navigate();
  await advance(2000);
  await view.rerender(<HeroProvider active><Navigator nullMeasure={null} onNavigate={onNavigate} sourcePresent={false} /></HeroProvider>);
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await fireEvent.press(screen.getByTestId('back'));
  expect(animateSpring).not.toHaveBeenCalled();
  expect(timing.mock.calls.some(([value, config]) => value === 0 && config?.duration === duration.reducedFade)).toBe(true);
  expect(screen.getByTestId('hero-overlay', { includeHiddenElements: true })).toBeOnTheScreen();
  await advance(duration.reducedFade + 32);
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('avatar-copy', { includeHiddenElements: true })).toBeNull();
});

test('P4-8: Back during entry cancels the forward run and returns without losing the request', async () => {
  await navigate();
  await advance(80);
  await fireEvent.press(screen.getByTestId('back'));
  expect(screen.queryByTestId('target-avatar', { includeHiddenElements: true })).toBeNull();
  await advance(2000);
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('source-avatar')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('source-name')).toHaveAnimatedStyle({ opacity: 1 });
});

test.each(['before layout', 'during spring'] as const)('P4-8: becoming inactive %s cancels and restores both endpoints', async (phase) => {
  const onNavigate = jest.fn();
  const view = await render(<HeroProvider active><Navigator nullMeasure={null} onNavigate={onNavigate} /></HeroProvider>);
  await fireEvent.press(screen.getByTestId('open-profile'));
  if (phase === 'during spring') {
    await fireEvent(screen.getByTestId('target-avatar', { includeHiddenElements: true }), 'layout');
    await fireEvent(screen.getByTestId('target-name', { includeHiddenElements: true }), 'layout');
    await advance(80);
  }
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await view.rerender(<HeroProvider active={false}><Navigator nullMeasure={null} onNavigate={onNavigate} /></HeroProvider>);
  expect(cancel).toHaveBeenCalled();
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  for (const id of ['source-avatar', 'source-name', 'target-avatar', 'target-name', 'target-body']) {
    expect(screen.getByTestId(id, { includeHiddenElements: true })).toHaveAnimatedStyle({ opacity: 1 });
  }
  const values = [...new Set(cancel.mock.calls.map(([value]) => value))];
  const stopped = values.map((value) => value.get());
  await advance(2000);
  expect(values.map((value) => value.get())).toEqual(stopped);
  expect(animateSpring).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
});
