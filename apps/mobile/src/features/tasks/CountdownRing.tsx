import type { Timer } from '@pawlaris/shared';
import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';
import { useEffect, useRef, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatDuration } from '../../i18n/format';
import type { Clock } from '../../platform/clock';
import { crescentPath } from '../../ui/cosmos/glyphs';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { useNow } from '../dashboard/useNow';
import { remainingTimerMs } from './timer';

export interface CountdownRingProps {
  timer: Pick<Timer, 'started_at' | 'ends_at'>;
  clock: Clock;
  active: boolean;
  testID?: string;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const size = 144;
const center = size / 2;
const radius = center - 8;
const circumference = 2 * Math.PI * radius;
const moonSize = 12;
const moon = crescentPath(moonSize / 2, moonSize / 2, moonSize / 2);

export function CountdownRing({ timer, clock, active, testID }: CountdownRingProps): ReactElement {
  const { color } = useTheme();
  const reduced = useReduceMotion();
  const enabled = useAnimationActive(active);
  // This tick updates text only; the arc and moon share one UI-thread timing.
  useNow(clock, 1000, active);
  const remaining = remainingTimerMs(timer.ends_at, clock);
  const total = Date.parse(timer.ends_at) - Date.parse(timer.started_at);
  const progress = useSharedValue(0);
  const previous = useRef({ endsAt: timer.ends_at, remaining, enabled });

  useEffect(() => {
    const left = remainingTimerMs(timer.ends_at, clock);
    progress.set(Math.min(1, left / total));
    if (enabled && !reduced && left > 0) {
      progress.set(withTiming(0, { duration: left, easing: Easing.linear }));
    }
    return () => { cancelAnimation(progress); };
  }, [timer.ends_at, total, clock, enabled, reduced, progress]);

  useEffect(() => {
    const last = previous.current;
    if (last.endsAt === timer.ends_at && last.remaining > 0 && remaining === 0 && last.enabled && enabled) {
      void notificationAsync(NotificationFeedbackType.Success);
    }
    previous.current = { endsAt: timer.ends_at, remaining, enabled };
  }, [timer.ends_at, remaining, enabled]);

  const arcProps = useAnimatedProps(() => {
    const left = progress.get() * total;
    return { strokeDashoffset: (1 - progress.get()) * circumference,
      stroke: left <= 0 ? color.success : left <= 10_000 ? color.warning : color.accent };
  });
  const moonStyle = useAnimatedStyle(() => {
    const angle = progress.get() * 2 * Math.PI - Math.PI / 2;
    return { transform: [{ translateX: Math.cos(angle) * radius }, { translateY: Math.sin(angle) * radius }] };
  });
  const ink = remaining === 0 ? color.success : remaining <= 10_000 ? color.warning : color.accent;
  return <View testID={testID} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Svg width={size} height={size} accessible={false} style={{ position: 'absolute' }}>
      <Circle cx={center} cy={center} r={radius} stroke={color.border} strokeWidth={3} fill="none" />
      {reduced ? <Circle cx={center} cy={center} r={radius} stroke={ink} strokeWidth={3} fill="none" />
        : <AnimatedCircle cx={center} cy={center} r={radius} strokeWidth={3} fill="none"
          strokeLinecap="round" strokeDasharray={[circumference, circumference]}
          rotation={-90} origin={`${center}, ${center}`} animatedProps={arcProps} />}
    </Svg>
    {!reduced && <Animated.View accessible={false} style={[{ position: 'absolute',
      left: center - moonSize / 2, top: center - moonSize / 2 }, moonStyle]}>
      <Svg width={moonSize} height={moonSize} accessible={false}><Path d={moon} fill={ink} /></Svg>
    </Animated.View>}
    <Text variant="heading">{formatDuration(remaining / 1000)}</Text>
  </View>;
}
