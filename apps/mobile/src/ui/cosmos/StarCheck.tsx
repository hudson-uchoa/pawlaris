import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useEffect, useRef, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';
import { duration, spring } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { accessibility } from '../tokens/accessibility';
import { starCheck } from '../tokens/cosmos';
import { radius } from '../tokens/radius';
import { starPath } from './glyphs';
import { Sparks } from './Sparks';

export type StarCheckProps = {
  checked: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  active: boolean;
  disabled?: boolean;
  testID?: string;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const glyph = starPath(starCheck.size / 2, starCheck.size / 2, starCheck.starRadius);

export function StarCheck({ checked, accessibilityLabel, onPress, active, disabled = false,
  testID }: StarCheckProps): ReactElement {
  const { color, scheme } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active && !disabled);
  const previousChecked = useRef(checked);
  const localPress = useRef(false);
  const scale = useSharedValue(1);
  const motionEnabled = useSharedValue(false);
  const fill = useSharedValue(checked ? 1 : 0);
  const starScale = useSharedValue(checked ? 1 : 0);
  const starOpacity = useSharedValue(checked ? 1 : 0);
  const burst = useSharedValue(1);

  useEffect(() => {
    const changed = previousChecked.current !== checked;
    previousChecked.current = checked;
    const localIgnition = changed && checked && localPress.current;
    if (changed || !animationActive) localPress.current = false;
    motionEnabled.set(animationActive && !reduced);
    scale.set(1);
    burst.set(1);
    if (!animationActive || !changed) {
      fill.set(checked ? 1 : 0);
      starScale.set(reduced || checked ? 1 : 0);
      starOpacity.set(checked ? 1 : 0);
    } else {
      fill.set(withTiming(checked ? 1 : 0, { duration: duration.quick }));
      if (localIgnition) void impactAsync(ImpactFeedbackStyle.Light);
      if (reduced) {
        starScale.set(1);
        starOpacity.set(withTiming(checked ? 1 : 0,
          { duration: checked ? duration.micro : duration.quick }));
      } else if (checked) {
        starOpacity.set(1);
        starScale.set(0);
        starScale.set(withSequence(withSpring(starCheck.ignitionScale, spring.bouncy), withSpring(1, spring.bouncy)));
        burst.set(0);
        burst.set(withTiming(1, { duration: duration.burst }));
      } else {
        starScale.set(withTiming(0, { duration: duration.quick }));
        starOpacity.set(withTiming(0, { duration: duration.quick }));
      }
    }
    return () => {
      motionEnabled.set(false);
      cancelAnimation(scale);
      cancelAnimation(fill);
      cancelAnimation(starScale);
      cancelAnimation(starOpacity);
      cancelAnimation(burst);
    };
  }, [checked, animationActive, reduced, scale, motionEnabled, fill, starScale, starOpacity, burst]);

  function feedback(pressed: boolean): void {
    'worklet';
    scale.set(!motionEnabled.get() ? 1 : withSpring(pressed ? starCheck.pressScale : 1, spring.stiff));
  }

  const pressedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.get() }));
  const starStyle = useAnimatedStyle(() => ({ opacity: starOpacity.get(), transform: [{ scale: starScale.get() }] }));
  return <AnimatedPressable testID={testID} accessible accessibilityRole="checkbox"
    accessibilityLabel={accessibilityLabel} accessibilityState={{ checked, disabled }} disabled={disabled}
    onPressIn={() => { scheduleOnUI(feedback, true); }}
    onPressOut={() => { scheduleOnUI(feedback, false); }}
    onPress={() => { if (!disabled) { localPress.current = !checked; onPress(); } }}
    style={[{ minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget,
      alignItems: 'center', justifyContent: 'center' }, pressedStyle]}>
    <View accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ width: starCheck.size, height: starCheck.size, borderRadius: radius.avatar,
        borderWidth: starCheck.strokeWidth, borderColor: color.textMuted }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color.accentSoft, borderRadius: radius.avatar }, fillStyle]} />
      <Animated.View testID={testID === undefined ? undefined : `${testID}-star`}
        style={[StyleSheet.absoluteFill, starStyle]}>
        <Svg width={starCheck.size} height={starCheck.size} accessible={false}
          style={{ position: 'absolute', left: -starCheck.strokeWidth, top: -starCheck.strokeWidth }}>
          <Path d={glyph} fill={color.star}
            {...(scheme === 'light' ? { stroke: color.starText, strokeWidth: starCheck.outlineWidth } : {})} />
        </Svg>
      </Animated.View>
    </View>
    <Sparks active={animationActive && checked && !reduced} progress={burst}
      {...(testID === undefined ? {} : { testID: `${testID}-sparks` })} />
  </AnimatedPressable>;
}
