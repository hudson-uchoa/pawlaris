import { useEffect, useId, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { duration } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { radius } from '../tokens/radius';

export type SkeletonProps = {
  width: number;
  height: number;
  active: boolean;
  testID?: string;
};

export function Skeleton({ width, height, active, testID }: SkeletonProps): ReactElement {
  const { color } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active);
  const progress = useSharedValue(0);
  const gradientId = useId();
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: width * (2 * progress.get() - 1) }] }));
  useEffect(() => {
    progress.set(0);
    if (animationActive && !reduced && width > 0 && height > 0) {
      progress.set(withRepeat(withTiming(1, { duration: duration.skeletonSweep, easing: Easing.linear }), -1, false));
    }
    return () => { cancelAnimation(progress); };
  }, [animationActive, reduced, progress, width, height]);
  return <View testID={testID} accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ width, height, backgroundColor: color.surfaceSunken, borderRadius: radius.chip, overflow: 'hidden' }}>
    {!reduced && animationActive && <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
      <Svg width={width} height={height}>
        <Defs><LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor={color.surface} stopOpacity={0} />
          <Stop offset="50%" stopColor={color.surface} />
          <Stop offset="100%" stopColor={color.surface} stopOpacity={0} />
        </LinearGradient></Defs>
        <Rect width={width} height={height} fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>}
  </View>;
}
