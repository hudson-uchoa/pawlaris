import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import Animated, { measure, useReducedMotion } from 'react-native-reanimated';
import { HeroProvider, useHeroSource, useHeroTarget } from '../motion/hero';
import { duration } from '../motion/tokens';
import { advance, springAnimation, timingAnimation } from './motionAuditSupport';

jest.mock('react-native-reanimated', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native-reanimated')),
  measure: { value: jest.fn(), configurable: true, enumerable: true },
  useReducedMotion: { value: jest.fn(), configurable: true, enumerable: true },
}));

type AnimationAPI = typeof import('react-native-reanimated');
type ThreadsAPI = typeof import('react-native-worklets');
type Frame = NonNullable<ReturnType<AnimationAPI['measure']>>;
const threadsEntry = jest.requireActual<{ main: string }>('react-native-worklets/package.json').main;
const threadsRoot = `react-native-worklets/${threadsEntry.replace(/\/index(?:\.js)?$/, '')}`;
const threads = jest.requireActual<Pick<ThreadsAPI, 'scheduleOnUI' | 'scheduleOnRN'>>(`${threadsRoot}/threads`);
const frames = new Map<unknown, Frame>();
const initialAppState = AppState.currentState;

// The MO-1 harness supplies valid frames so a failed measure cannot mask a
// regression in the Reduce Motion branch. Reanimated runs the real fade.
function frame(pageX: number, pageY: number, width: number, height: number): Frame {
  return { x: 0, y: 0, pageX, pageY, width, height };
}

function Source({ onNavigate }: { onNavigate(): void }) {
  const source = useHeroSource('pet-1');
  frames.set(source.avatar.ref, frame(20, 80, 64, 64));
  frames.set(source.name.ref, frame(30, 160, 80, 24));
  return <Pressable testID="open-profile" onPress={() => {
    source.start({ avatar: <View />, name: <View /> }, onNavigate);
  }}>
    <Animated.View testID="source-avatar" {...source.avatar} />
    <Animated.View testID="source-name" {...source.name} />
  </Pressable>;
}

function Target() {
  const target = useHeroTarget('pet-1', true);
  frames.set(target.avatar.ref, frame(100, 60, 128, 128));
  frames.set(target.name.ref, frame(120, 210, 100, 32));
  return <>
    <Animated.View testID="target-avatar" {...target.avatar} />
    <Animated.View testID="target-name" {...target.name} />
    <Animated.View testID="target-body" style={target.contentStyle} />
  </>;
}

function Navigator() {
  const [profile, setProfile] = useState(false);
  return <><Source onNavigate={() => { setProfile(true); }} />{profile && <Target />}</>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useReducedMotion).mockReturnValue(true);
  frames.clear();
  jest.mocked(measure).mockImplementation((ref) => frames.get(ref) ?? null);
  // Reuse MO-1's immediate thread handoffs in Jest's single runtime.
  jest.spyOn(threads, 'scheduleOnUI').mockImplementation((worklet, ...args) => { worklet(...args); });
  jest.spyOn(threads, 'scheduleOnRN').mockImplementation((callback, ...args) => { callback(...args); });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('MO-1 Hero transition: 150 ms crossfade without a spring', async () => {
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await render(<HeroProvider active><Navigator /></HeroProvider>);
  await fireEvent.press(screen.getByTestId('open-profile'));
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 128, height: 128 } } };
  await fireEvent(screen.getByTestId('target-avatar', { includeHiddenElements: true }), 'layout', layout);
  await fireEvent(screen.getByTestId('target-name', { includeHiddenElements: true }), 'layout', layout);
  expect(duration.reducedFade).toBe(150);
  expect(timing.mock.calls.some(([value, config]) => value === 1 && config?.duration === duration.reducedFade)).toBe(true);
  await advance(duration.reducedFade + 32);
  expect(screen.getByTestId('target-body')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('target-avatar')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('target-name')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.getByTestId('source-avatar')).toHaveAnimatedStyle({ opacity: 1 });
  expect(screen.queryByTestId('hero-overlay', { includeHiddenElements: true })).toBeNull();
  expect(spring).not.toHaveBeenCalled();
});
