import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { duration, spring } from '../../tokens';
import * as ReduceMotion from '../../useReduceMotion';
import { HeroProvider, useHeroSource, useHeroTarget } from '..';

type AnimationAPI = typeof import('react-native-reanimated');
type Frame = NonNullable<ReturnType<AnimationAPI['measure']>>;
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const measurement = jest.requireActual<Pick<AnimationAPI, 'measure'>>(`${animationRoot}/platformFunctions/measure`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const frames = new Map<unknown, Frame | null>();
const initialAppState = AppState.currentState;

function frame(pageX: number, pageY: number, width: number, height: number): Frame {
  return { x: 0, y: 0, pageX, pageY, width, height };
}

function Target({ nullMeasure }: { nullMeasure: boolean }) {
  const target = useHeroTarget('pet-1');
  frames.set(target.avatar.ref, nullMeasure ? null : frame(100, 60, 128, 128));
  frames.set(target.name.ref, frame(120, 210, 100, 32));
  return <>
    <Animated.View testID="target-avatar" {...target.avatar}><View /></Animated.View>
    <Animated.View testID="target-name" {...target.name}><Text>Pet</Text></Animated.View>
    <Animated.View testID="target-body" style={target.contentStyle} />
  </>;
}

function Navigator({ nullMeasure, onNavigate }: {
  nullMeasure: 'source' | 'target' | null;
  onNavigate(): void;
}) {
  const source = useHeroSource('pet-1');
  const [profile, setProfile] = useState(false);
  const content = { avatar: <View testID="avatar-copy" />, name: <Text testID="name-copy">Pet</Text> };
  frames.set(source.avatar.ref, nullMeasure === 'source' ? null : frame(20, 80, 64, 64));
  frames.set(source.name.ref, frame(30, 160, 80, 24));
  return <>
    <Pressable testID="open-profile" onPress={() => {
      source.start(content, () => { onNavigate(); setProfile(true); });
    }}>
      <Animated.View testID="source-avatar" {...source.avatar}><View /></Animated.View>
      <Animated.View testID="source-name" {...source.name}><Text>Pet</Text></Animated.View>
    </Pressable>
    {profile && <Target nullMeasure={nullMeasure === 'target'} />}
  </>;
}

async function navigate(nullMeasure: 'source' | 'target' | null = null) {
  const onNavigate = jest.fn();
  await render(<HeroProvider active><Navigator nullMeasure={nullMeasure} onNavigate={onNavigate} /></HeroProvider>);
  await fireEvent.press(screen.getByTestId('open-profile'));
  expect(onNavigate).toHaveBeenCalledTimes(1);
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 128, height: 128 } } };
  await fireEvent(screen.getByTestId('target-avatar', { includeHiddenElements: true }), 'layout', layout);
  await fireEvent(screen.getByTestId('target-name', { includeHiddenElements: true }), 'layout', layout);
}

async function advance(milliseconds: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  frames.clear();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  jest.spyOn(measurement, 'measure').mockImplementation((ref) => frames.get(ref) ?? null);
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

test.each(['source', 'target'] as const)('P4-8: a null %s measure takes the crossfade path', async (endpoint) => {
  const animateSpring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await navigate(endpoint);
  expect(measurement.measure).toHaveBeenCalled();
  // Q-45: measurement failures use the same fade duration as Reduce Motion.
  expect(timing.mock.calls.some(([value, config]) => value === 1 && config?.duration === duration.reducedFade)).toBe(true);
  await advance(duration.reducedFade + 32);
  expect(screen.getByTestId('target-body')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('target-avatar')).toHaveAnimatedStyle({ opacity: 1 });
  expect(animateSpring).not.toHaveBeenCalled();
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
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
