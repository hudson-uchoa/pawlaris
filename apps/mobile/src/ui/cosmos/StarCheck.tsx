import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import Svg, { Circle as SvgCircle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { duration, spring } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { accessibility } from '../tokens/accessibility';
import { burst as burstTokens, starCheck } from '../tokens/cosmos';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { starPath } from './glyphs';
import { StarBurstCanvas } from './BurstCanvas';

export type StarCheckProps = {
  checked: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  active: boolean;
  occurrenceKey?: string;
  disabled?: boolean;
  testID?: string;
  children?: ReactNode;
  badge?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const glyph = starPath(starCheck.size / 2, starCheck.size / 2, starCheck.starRadius);

export function StarCheck({ checked, accessibilityLabel, onPress, active, disabled = false,
  occurrenceKey, testID, children, badge = false }: StarCheckProps): ReactElement {
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
  const halo = useSharedValue(checked ? burstTokens.halo.settled : 0);
  const [burstPlaying, setBurstPlaying] = useState(false);
  const finishBurst = useCallback(() => { setBurstPlaying(false); }, []);
  const haloId = useId();
  if (burstPlaying && (!animationActive || reduced)) setBurstPlaying(false);

  useEffect(() => {
    const changed = previousChecked.current !== checked;
    previousChecked.current = checked;
    const localIgnition = changed && checked && localPress.current;
    if (changed || !animationActive) localPress.current = false;
    motionEnabled.set(animationActive && !reduced);
    scale.set(1);
    halo.set(checked ? burstTokens.halo.settled : 0);
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
        if (localIgnition) {
          halo.set(withSequence(withTiming(burstTokens.halo.peak, { duration: duration.micro }),
            withTiming(burstTokens.halo.settled, { duration: burstTokens.duration - duration.micro })));
        }
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
      cancelAnimation(halo);
    };
  }, [checked, animationActive, reduced, scale, motionEnabled, fill, starScale, starOpacity, halo]);

  function feedback(pressed: boolean): void {
    'worklet';
    scale.set(!motionEnabled.get() ? 1 : withSpring(pressed ? starCheck.pressScale : 1, spring.stiff));
  }

  const pressedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.get() }));
  const starStyle = useAnimatedStyle(() => ({ opacity: starOpacity.get(), transform: [{ scale: starScale.get() }] }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.get() }));
  return <AnimatedPressable testID={testID} accessible accessibilityRole="checkbox"
    accessibilityLabel={accessibilityLabel} accessibilityState={{ checked, disabled }} disabled={disabled}
    onPressIn={() => { scheduleOnUI(feedback, true); }}
    onPressOut={() => { scheduleOnUI(feedback, false); }}
    onPress={() => { if (!disabled) {
      localPress.current = !checked;
      setBurstPlaying(!checked && animationActive && !reduced);
      onPress();
    } }}
    style={[{ minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget,
      alignItems: 'center', justifyContent: 'center' }, pressedStyle]}>
    {children}
    <View pointerEvents="none" style={badge ? { position: 'absolute', top: spacing.xxl - starCheck.size / 2,
      left: '50%', marginLeft: spacing.xxl / 2 - starCheck.size / 2,
      transform: [{ scale: starCheck.badgeScale }] } : undefined}>
    <View accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ width: starCheck.size, height: starCheck.size, borderRadius: radius.avatar,
        borderWidth: starCheck.strokeWidth, borderColor: color.textMuted, opacity: disabled ? 0.4 : 1 }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute',
        width: burstTokens.halo.radius * 2, height: burstTokens.halo.radius * 2,
        left: starCheck.size / 2 - burstTokens.halo.radius - starCheck.strokeWidth,
        top: starCheck.size / 2 - burstTokens.halo.radius - starCheck.strokeWidth,
        borderRadius: radius.avatar }, haloStyle]}>
        <Svg width={burstTokens.halo.radius * 2} height={burstTokens.halo.radius * 2} accessible={false}>
          <Defs><RadialGradient id={haloId}>
            <Stop offset="0" stopColor={color.star} /><Stop offset="1" stopColor={color.star} stopOpacity={0} />
          </RadialGradient></Defs>
          <SvgCircle cx={burstTokens.halo.radius} cy={burstTokens.halo.radius}
            r={burstTokens.halo.radius} fill={`url(#${haloId})`} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color.accentSoft, borderRadius: radius.avatar }, fillStyle]} />
      <Animated.View testID={testID === undefined || badge ? undefined : `${testID}-star`}
        style={[StyleSheet.absoluteFill, starStyle]}>
        <Svg width={starCheck.size} height={starCheck.size} accessible={false}
          style={{ position: 'absolute', left: -starCheck.strokeWidth, top: -starCheck.strokeWidth }}>
          <Path d={glyph} fill={color.star}
            {...(scheme === 'light' ? { stroke: color.starText, strokeWidth: starCheck.outlineWidth } : {})} />
        </Svg>
      </Animated.View>
    </View>
    {burstPlaying && animationActive && checked && !reduced && <View pointerEvents="none"
      testID={testID === undefined || badge ? undefined : `${testID}-sparks`}
      style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      <StarBurstCanvas occurrenceKey={occurrenceKey ?? testID ?? accessibilityLabel} onDone={finishBurst}
        {...(testID === undefined ? {} : { testID: `${testID}-burst` })} />
    </View>}
    </View>
  </AnimatedPressable>;
}
