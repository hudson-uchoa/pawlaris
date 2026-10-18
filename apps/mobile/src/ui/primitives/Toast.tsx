import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { duration, hold, spring, toastTravel } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { borderWidth, elevation } from '../tokens/elevation';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { Button } from './Button';
import { Text } from './Text';

export type ToastProps = {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
  active?: boolean;
  testID?: string;
  dismissRequested?: boolean;
};

export type ToastProviderProps = {
  children: ReactNode;
  dismissLabel: string;
};

export type ToastController = {
  show: (message: string) => void;
  dismiss: () => void;
};

type Notice = { id: number; message: string };
type ToastState = { sequence: number; notice: Notice | null; dismissRequested: boolean };
type ToastContextValue = {
  notice: Notice | null;
  dismissRequested: boolean;
  dismissLabel: string;
  controller: ToastController;
  remove(id: number): void;
};
const ToastContext = createContext<ToastContextValue | null>(null);

export function Toast(props: ToastProps): ReactElement {
  // A changed message is a new notice even for callers without a host.
  return <ToastNotice key={props.message} {...props} />;
}

function ToastNotice({ message, dismissLabel, onDismiss, active = true, testID,
  dismissRequested = false }: ToastProps): ReactElement | null {
  const { color } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active);
  const [present, setPresent] = useState(true);
  const alive = useRef(true);
  const dismissCallback = useRef(onDismiss);
  const phase = useSharedValue<'entering' | 'holding' | 'exiting' | 'hidden'>('entering');
  const travel = useSharedValue(reduced ? 0 : toastTravel);
  const opacity = useSharedValue(0);
  const holdProgress = useSharedValue(0);
  const entryParts = useSharedValue(0);
  const motionActive = useSharedValue(false);
  const reduceMotion = useSharedValue(reduced);

  useLayoutEffect(() => { dismissCallback.current = onDismiss; }, [onDismiss]);
  const finishDismiss = useCallback(() => {
    if (!alive.current) return;
    setPresent(false);
    dismissCallback.current();
  }, []);

  const runExit = useCallback(() => {
    'worklet';
    phase.set('exiting');
    cancelAnimation(holdProgress);
    cancelAnimation(travel);
    cancelAnimation(opacity);
    const finish = (finished: boolean | undefined) => {
      'worklet';
      if (!finished || phase.get() !== 'exiting') return;
      phase.set('hidden');
      scheduleOnRN(finishDismiss);
    };
    if (!motionActive.get()) {
      travel.set(0);
      opacity.set(0);
      finish(true);
    } else {
      if (reduceMotion.get()) travel.set(0);
      else travel.set(withTiming(toastTravel, { duration: duration.quick }));
      opacity.set(withTiming(0,
        { duration: reduceMotion.get() ? duration.reducedFade : duration.quick }, finish));
    }
  }, [phase, holdProgress, travel, opacity, motionActive, reduceMotion, finishDismiss]);
  const close = useCallback(() => {
    'worklet';
    if (phase.get() !== 'exiting' && phase.get() !== 'hidden') runExit();
  }, [phase, runExit]);
  const requestDismiss = useCallback(() => { close(); }, [close]);
  const startHold = useCallback(() => {
    'worklet';
    phase.set('holding');
    // This value is a UI-thread timer, not a visual. Keeping its fraction
    // lets lifecycle cancellation preserve the remaining hold without a clock.
    holdProgress.set(withTiming(1, { duration: hold.toast * (1 - holdProgress.get()),
      easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (finished) => {
      if (finished && motionActive.get() && phase.get() === 'holding') runExit();
    }));
  }, [phase, holdProgress, motionActive, runExit]);

  useLayoutEffect(() => {
    motionActive.set(animationActive);
    reduceMotion.set(reduced);
    if (phase.get() === 'exiting') {
      runExit();
    } else if (phase.get() !== 'hidden') {
      if (!animationActive) {
        travel.set(0);
        opacity.set(1);
        phase.set('holding');
      } else if (phase.get() === 'holding') {
        travel.set(0);
        opacity.set(1);
        startHold();
      } else {
        entryParts.set(reduced ? 1 : 0);
        const finishPart = (finished: boolean | undefined) => {
          'worklet';
          if (!finished || phase.get() !== 'entering' || !motionActive.get()) return;
          entryParts.set(entryParts.get() + 1);
          if (entryParts.get() === 2) startHold();
        };
        if (reduced) {
          travel.set(0);
          opacity.set(withTiming(1, { duration: duration.reducedFade }, finishPart));
        } else {
          travel.set(withSpring(0, spring.gentle, finishPart));
          opacity.set(withSpring(1, spring.gentle, finishPart));
        }
      }
    }
    return () => {
      motionActive.set(false);
      cancelAnimation(travel);
      cancelAnimation(opacity);
      cancelAnimation(holdProgress);
    };
  }, [animationActive, reduced, motionActive, reduceMotion, phase, travel, opacity,
    entryParts, startHold, runExit, holdProgress]);
  useLayoutEffect(() => { if (dismissRequested) requestDismiss(); }, [dismissRequested, requestDismiss]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.get(),
    transform: [{ translateY: travel.get() }] }));
  if (!present) return null;
  return <Animated.View testID={testID} style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, backgroundColor: color.surface, borderColor: color.border,
    borderWidth, borderRadius: radius.card, elevation: elevation.card }, animatedStyle]}>
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite"
      accessibilityLabel={message} style={{ flex: 1 }}><Text>{message}</Text></View>
    <Button label={dismissLabel} accessibilityLabel={dismissLabel} onPress={requestDismiss} active={active} />
  </Animated.View>;
}

export function ToastProvider({ children, dismissLabel }: ToastProviderProps): ReactElement {
  const [state, setState] = useState<ToastState>({ sequence: 0, notice: null, dismissRequested: false });
  const controller = useMemo<ToastController>(() => ({
    show(message) {
      setState((previous) => ({ sequence: previous.sequence + 1,
        notice: { id: previous.sequence + 1, message }, dismissRequested: false }));
    },
    dismiss() {
      setState((previous) => previous.notice === null ? previous : { ...previous, dismissRequested: true });
    },
  }), []);
  const remove = useCallback((id: number) => {
    setState((previous) => previous.notice?.id === id ? { ...previous, notice: null } : previous);
  }, []);
  const { notice, dismissRequested } = state;
  const value = useMemo(() => ({ notice, dismissRequested, dismissLabel, controller, remove }),
    [notice, dismissRequested, dismissLabel, controller, remove]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export type ToastHostProps = { active?: boolean; bottomInset?: number };

export function ToastHost(props: ToastHostProps = {}): ReactElement | null {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('ToastHost requires a ToastProvider');
  const { notice } = context;
  if (notice === null) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md,
    bottom: spacing.lg + (props.bottomInset ?? 0) }}>
    <Toast key={notice.id} message={notice.message} dismissLabel={context.dismissLabel}
      onDismiss={() => { context.remove(notice.id); }} dismissRequested={context.dismissRequested}
      active={props.active ?? true} testID="toast" />
  </View>;
}

export function useToast(): ToastController {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('useToast requires a ToastProvider');
  return context.controller;
}
