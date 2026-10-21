import { useEffect, useRef, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Polyline } from 'react-native-svg';
import { duration } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { useTheme } from '../../ui/theme';
import { lineLength } from './routeGeometry';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

export function SavedRoute({ points, width, height, active: focused, onDrawn }: {
  points: readonly [number, number][]; width: number; height: number;
  active: boolean; onDrawn(): void;
}): ReactElement {
  const { color } = useTheme();
  const active = useAnimationActive(focused);
  const reduced = useReduceMotion();
  const played = useRef(false);
  const complete = useRef(onDrawn);
  useEffect(() => { complete.current = onDrawn; }, [onDrawn]);
  const progress = useSharedValue(active && !reduced ? 0 : 1);
  const length = Math.max(1, lineLength(points));
  useEffect(() => {
    cancelAnimation(progress);
    const finish = (): void => { complete.current(); };
    if (!played.current && active && !reduced) {
      played.current = true;
      progress.set(0);
      progress.set(withTiming(1, { duration: duration.walkRoute }, (finished) => {
        if (finished) scheduleOnRN(finish);
      }));
    } else {
      played.current = true;
      progress.set(1);
      finish();
    }
    return () => { cancelAnimation(progress); };
  }, [active, reduced, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.get()) }));
  return <Svg testID="walk-route-draw" width={width} height={height} pointerEvents="none"
    accessible={false} style={StyleSheet.absoluteFill}>
    <AnimatedPolyline testID="walk-route-stroke" points={points.map((pair) => pair.join(',')).join(' ')} fill="none"
      stroke={color.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={[length, length]} animatedProps={animatedProps} />
  </Svg>;
}
