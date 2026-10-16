import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { duration, sheetDismissFraction, sheetFlingVelocity, spring } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { accessibility } from '../tokens/accessibility';
import { borderWidth, elevation } from '../tokens/elevation';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { Button } from './Button';

export type SheetProps = {
  visible: boolean;
  active?: boolean;
  accessibilityLabel: string;
  dismissLabel: string;
  onDismiss: () => void;
  children: ReactNode;
  testID?: string;
};

export function Sheet({ visible, active: focused = true, accessibilityLabel, dismissLabel, onDismiss, children, testID }: SheetProps): ReactElement | null {
  const { color } = useTheme();
  const reduced = useReduceMotion();
  const active = useAnimationActive(visible && focused);
  const windowHeight = useWindowDimensions().height;
  const height = useSharedValue(windowHeight);
  const travel = useSharedValue(windowHeight);
  const opacity = useSharedValue(0);
  const gestureEnabled = useSharedValue(false);

  useEffect(() => {
    gestureEnabled.set(active);
    cancelAnimation(travel);
    cancelAnimation(opacity);
    if (!visible) {
      travel.set(windowHeight);
      opacity.set(0);
    } else if (!active) {
      travel.set(0);
      opacity.set(1);
    } else if (reduced) {
      travel.set(0);
      opacity.set(withTiming(1, { duration: duration.reducedFade }));
    } else {
      travel.set(withSpring(0, spring.gentle));
      opacity.set(withTiming(1, { duration: duration.sheet }));
    }
    return () => { gestureEnabled.set(false); cancelAnimation(travel); cancelAnimation(opacity); };
  }, [visible, active, reduced, windowHeight, travel, opacity, gestureEnabled]);

  const gesture = useMemo(() => Gesture.Pan().enabled(active)
    .withTestId(`${testID ?? 'sheet'}-pan`)
    .onBegin(() => { if (gestureEnabled.get()) cancelAnimation(travel); })
    .onUpdate((event) => { if (gestureEnabled.get() && !reduced) travel.set(Math.max(0, event.translationY)); })
    .onEnd((event) => {
      if (!gestureEnabled.get()) return;
      if (event.translationY > height.get() * sheetDismissFraction || event.velocityY > sheetFlingVelocity) {
        scheduleOnRN(onDismiss);
      } else if (!reduced) {
        travel.set(withSpring(0, spring.gentle));
      }
    }).onFinalize((_event, succeeded) => {
      if (gestureEnabled.get() && !succeeded && !reduced) travel.set(withSpring(0, spring.gentle));
    }), [active, reduced, testID, travel, height, onDismiss, gestureEnabled]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const sheetStyle = useAnimatedStyle(() => reduced
    ? { opacity: opacity.get() } : { transform: [{ translateY: travel.get() }] });
  if (!visible) return null;
  return <Modal testID={testID === undefined ? undefined : `${testID}-modal`}
    transparent visible animationType="none" onRequestClose={onDismiss}>
    <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim }, scrimStyle]}>
        <Pressable accessible={false} accessibilityRole="button" accessibilityLabel={dismissLabel}
          testID={testID === undefined ? undefined : `${testID}-scrim`}
          importantForAccessibility="no-hide-descendants" onPress={onDismiss}
          style={[StyleSheet.absoluteFill, { minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget }]} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View accessible role="dialog" accessibilityLabel={accessibilityLabel} accessibilityViewIsModal
          testID={testID} onLayout={(event) => { height.set(event.nativeEvent.layout.height); }}
          style={[{ backgroundColor: color.surface, borderColor: color.border, borderWidth,
            borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
            elevation: elevation.sheet, padding: spacing.lg, maxHeight: '100%' }, sheetStyle]}>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: spacing.md }}>{children}</ScrollView>
          <Button label={dismissLabel} accessibilityLabel={dismissLabel} onPress={onDismiss} active={focused} />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  </Modal>;
}
