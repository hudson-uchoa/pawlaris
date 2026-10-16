import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import Animated, { cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { duration } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { constellation } from '../tokens/cosmos';

export type ConstellationPoint = { x: number; y: number };
export type ConstellationLineProps = {
  points: readonly ConstellationPoint[];
  width: number;
  height: number;
  complete: boolean;
  active: boolean;
  testID?: string;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function ConstellationLine({ points, width, height, complete, active,
  testID }: ConstellationLineProps): ReactElement | null {
  const { color } = useTheme();
  const animationActive = useAnimationActive(active);
  const reduced = useReduceMotion();
  const previousComplete = useRef(complete);
  const { path, length } = useMemo(() => {
    const length = points.reduce((sum, point, index) => {
      const previous = points[index - 1];
      return sum + (previous === undefined ? 0 : Math.hypot(point.x - previous.x, point.y - previous.y));
    }, 0);
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
    return { path, length };
  }, [points]);
  const offset = useSharedValue(length);
  useEffect(() => {
    const changed = previousComplete.current !== complete;
    previousComplete.current = complete;
    offset.set(complete ? 0 : length);
    if (changed && complete && animationActive && !reduced) {
      offset.set(length);
      offset.set(withTiming(0, { duration: duration.base }));
    }
    return () => { cancelAnimation(offset); };
  }, [complete, animationActive, reduced, length, path, offset]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.get() }));
  if (!complete || length === 0) return null;
  return <Svg {...(testID === undefined ? {} : { testID })} width={width} height={height} pointerEvents="none"
    accessible={false} importantForAccessibility="no-hide-descendants">
    <AnimatedPath d={path} fill="none" stroke={color[constellation.color]}
      strokeWidth={constellation.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={[length, length]} animatedProps={animatedProps} />
  </Svg>;
}
