import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
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
  const active = useAnimationActive(focused);
  const [present, setPresent] = useState(visible);
  const [dismissal, setDismissal] = useState<{ run: number; notify: boolean } | null>(null);
  const previousVisible = useRef(false);
  const previousMotion = useRef({ active, reduced });
  const cycle = useRef(0);
  const dismissCallback = useRef(onDismiss);
  const windowHeight = useWindowDimensions().height;
  const height = useSharedValue(windowHeight);
  const travel = useSharedValue(windowHeight);
  const opacity = useSharedValue(0);
  const gestureEnabled = useSharedValue(false);
  const shown = useSharedValue(false);
  const exiting = useSharedValue(false);
  const notifyDismiss = useSharedValue(false);
  const motionActive = useSharedValue(false);
  const reduceMotion = useSharedValue(reduced);
  const generation = useSharedValue(0);

  useLayoutEffect(() => { dismissCallback.current = onDismiss; }, [onDismiss]);
  const finishDismiss = useCallback((run: number, notify: boolean) => {
    setDismissal({ run, notify });
  }, []);

  const close = useCallback((notify: boolean) => {
    'worklet';
    if (!shown.get() || exiting.get()) return;
    exiting.set(true);
    notifyDismiss.set(notify);
    gestureEnabled.set(false);
    cancelAnimation(travel);
    cancelAnimation(opacity);
    const run = generation.get();
    const finish = (finished: boolean | undefined) => {
      'worklet';
      if (!finished || generation.get() !== run) return;
      shown.set(false);
      scheduleOnRN(finishDismiss, run, notify);
    };
    if (!motionActive.get()) {
      travel.set(height.get());
      opacity.set(0);
      finish(true);
    } else {
      if (reduceMotion.get()) travel.set(0);
      else travel.set(withTiming(height.get(), { duration: duration.quick }));
      opacity.set(withTiming(0,
        { duration: reduceMotion.get() ? duration.reducedFade : duration.quick }, finish));
    }
  }, [shown, exiting, notifyDismiss, gestureEnabled, travel, opacity, generation,
    finishDismiss, motionActive, height, reduceMotion]);
  const requestDismiss = useCallback(() => { close(true); }, [close]);

  useLayoutEffect(() => {
    const opening = visible && !previousVisible.current;
    previousVisible.current = visible;
    const motionChanged = active !== previousMotion.current.active || reduced !== previousMotion.current.reduced;
    previousMotion.current = { active, reduced };
    if (opening) {
      cycle.current += 1;
      setPresent(true);
    }
    const run = cycle.current;
    generation.set(run);
    motionActive.set(active);
    reduceMotion.set(reduced);
    if (opening) {
      cancelAnimation(travel);
      cancelAnimation(opacity);
      shown.set(true);
      exiting.set(false);
      if (!active) {
        travel.set(0);
        opacity.set(1);
      } else if (reduced) {
        travel.set(0);
        opacity.set(0);
        opacity.set(withTiming(1, { duration: duration.reducedFade }));
      } else {
        travel.set(height.get());
        opacity.set(0);
        travel.set(withSpring(0, spring.gentle));
        opacity.set(withTiming(1, { duration: duration.sheet }));
      }
    } else if (exiting.get() && motionChanged) {
      exiting.set(false);
      close(notifyDismiss.get());
    } else if (!visible) {
      close(false);
    } else if (shown.get() && motionChanged && !exiting.get()) {
      cancelAnimation(travel);
      cancelAnimation(opacity);
      travel.set(0);
      opacity.set(1);
    }
    gestureEnabled.set(active && shown.get() && !exiting.get());
  }, [visible, active, reduced, windowHeight, travel, opacity, gestureEnabled, generation,
    motionActive, reduceMotion, shown, exiting, height, close, notifyDismiss]);

  useLayoutEffect(() => {
    if (dismissal === null || cycle.current !== dismissal.run) return;
    setPresent(false);
    if (dismissal.notify) dismissCallback.current();
  }, [dismissal]);

  useLayoutEffect(() => () => {
    cycle.current += 1;
    previousVisible.current = false;
    motionActive.set(false);
    shown.set(false);
    gestureEnabled.set(false);
    cancelAnimation(travel);
    cancelAnimation(opacity);
  }, [motionActive, shown, gestureEnabled, travel, opacity]);

  const handlePanEnd = useCallback((event: { translationY: number; velocityY: number }) => {
    'worklet';
    if (!gestureEnabled.get()) return;
    if (event.translationY > height.get() * sheetDismissFraction || event.velocityY > sheetFlingVelocity) {
      close(true);
    } else if (!reduced) {
      travel.set(withSpring(0, spring.gentle));
    }
  }, [gestureEnabled, height, close, reduced, travel]);
  const gesture = useMemo(() => Gesture.Pan().enabled(active)
    .withTestId(`${testID ?? 'sheet'}-pan`)
    .onBegin(() => { if (gestureEnabled.get()) cancelAnimation(travel); })
    .onUpdate((event) => { if (gestureEnabled.get() && !reduced) travel.set(Math.max(0, event.translationY)); })
    .onEnd(handlePanEnd).onFinalize((_event, succeeded) => {
      if (gestureEnabled.get() && !succeeded && !reduced) travel.set(withSpring(0, spring.gentle));
    }), [active, reduced, testID, travel, handlePanEnd, gestureEnabled]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const sheetStyle = useAnimatedStyle(() => reduced
    ? { opacity: opacity.get() } : { transform: [{ translateY: travel.get() }] });
  if (!present) return null;
  return <Modal testID={testID === undefined ? undefined : `${testID}-modal`}
    transparent visible animationType="none" onRequestClose={requestDismiss}>
    <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim }, scrimStyle]}>
        <Pressable accessible={false} accessibilityRole="button" accessibilityLabel={dismissLabel}
          testID={testID === undefined ? undefined : `${testID}-scrim`}
          importantForAccessibility="no-hide-descendants" onPress={requestDismiss}
          style={[StyleSheet.absoluteFill, { minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget }]} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View accessible role="dialog" accessibilityLabel={accessibilityLabel} accessibilityViewIsModal
          testID={testID} onLayout={(event) => { height.set(event.nativeEvent.layout.height); }}
          style={[{ backgroundColor: color.surface, borderColor: color.border, borderWidth,
            borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
            elevation: elevation.sheet, padding: spacing.lg, maxHeight: '100%' }, sheetStyle]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: spacing.md }}>{children}</ScrollView>
          <Button label={dismissLabel} accessibilityLabel={dismissLabel} onPress={requestDismiss} active={focused} />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  </Modal>;
}
