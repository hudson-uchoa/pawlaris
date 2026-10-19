import { clamp, defineAnimation, type AnimationObject, type SharedValue } from 'react-native-reanimated';

interface SkyClockAnimation extends AnimationObject<number> {
  current: number;
  previousFrame: number;
}

// A cancellable elapsed clock, using Reanimated's UI-frame timestamps. Restart
// from the retained value so background time never advances the sky or events.
export function skyClock(scroll: SharedValue<number>, height: number, scrollY?: SharedValue<number>): number {
  'worklet';
  return defineAnimation<SkyClockAnimation>(0, () => ({
    // A clock has no target; do not short-circuit when current equals zero.
    isHigherOrder: true,
    current: 0,
    previousFrame: 0,
    reduceMotion: false,
    onStart(animation: SkyClockAnimation, value: number, timestamp: number) {
      animation.current = value;
      animation.previousFrame = timestamp;
      if (scrollY !== undefined) scroll.set(clamp(scrollY.get(), 0, height));
    },
    onFrame(animation: SkyClockAnimation, timestamp: number) {
      animation.current += Math.max(0, timestamp - animation.previousFrame);
      animation.previousFrame = timestamp;
      if (scrollY !== undefined) scroll.set(clamp(scrollY.get(), 0, height));
      return false;
    },
  })) as unknown as number;
}
