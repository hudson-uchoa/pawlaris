import { useEffect, useRef, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { useTheme } from '../../ui/theme';

export function CometHead({ fix, active: focused }: { fix: number; active: boolean }): ReactElement {
  const { color } = useTheme();
  const active = useAnimationActive(focused);
  const reduced = useReduceMotion();
  const previous = useRef<number | null>(null);
  const pulse = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(pulse);
    const changed = previous.current !== fix;
    previous.current = fix;
    pulse.set(1);
    if (changed && active && !reduced) {
      pulse.set(0);
      pulse.set(withTiming(1, { duration: duration.burst }));
    }
    return () => { cancelAnimation(pulse); };
  }, [fix, active, reduced, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - pulse.get()),
    transform: [{ scale: 1 + pulse.get() * 2 }] }));
  return <View testID="walk-comet" accessible={false}
    style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View testID="walk-fix-pulse" style={[StyleSheet.absoluteFill,
      { borderRadius: 16, borderWidth: 2, borderColor: color.star }, ring]} />
    <View testID="walk-position" style={{ width: 12, height: 12, borderRadius: 6,
      backgroundColor: color.star, borderColor: color.bg, borderWidth: 2 }} />
  </View>;
}
