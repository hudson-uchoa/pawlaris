import { useEffect, type ReactElement } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { pressScale, spring } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { accessibility } from '../tokens/accessibility';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'accessibilityLabel' | 'style'> & {
  accessibilityLabel: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PressableScale({ active = true, disabled = false, onPressIn, onPressOut,
  onPress, style, accessibilityRole = 'button', accessibilityState, ...props }: PressableScaleProps): ReactElement {
  const reduced = useReduceMotion();
  const unavailable = disabled === true;
  const animationActive = useAnimationActive(active && !unavailable);
  const scale = useSharedValue(1);
  const motionEnabled = useSharedValue(false);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  useEffect(() => {
    motionEnabled.set(animationActive && !reduced);
    if (reduced || !animationActive) {
      cancelAnimation(scale);
      scale.set(1);
    }
    return () => { motionEnabled.set(false); cancelAnimation(scale); };
  }, [reduced, animationActive, scale, motionEnabled]);

  function feedback(pressed: boolean) {
    'worklet';
    scale.set(!motionEnabled.get() ? 1 : withSpring(pressed ? pressScale : 1, spring.stiff));
  }

  return <AnimatedPressable {...props} disabled={unavailable} accessibilityRole={accessibilityRole}
    accessibilityState={{ ...accessibilityState, disabled: unavailable }}
    onPress={unavailable ? undefined : onPress}
    onPressIn={(event) => { scheduleOnUI(feedback, true); onPressIn?.(event); }}
    onPressOut={(event) => { scheduleOnUI(feedback, false); onPressOut?.(event); }}
    style={[{ minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget }, style, animatedStyle]} />;
}
