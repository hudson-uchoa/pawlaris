import { localDate, type WeightEntry } from '@pawlaris/shared';
import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { formatDecimal, formatShortDate } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { starPath } from '../../ui/cosmos/glyphs';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { icon } from '../../ui/tokens/icon';
import { spacing } from '../../ui/tokens/spacing';
import { typography } from '../../ui/tokens/type';
import { weightChartGeometry, type WeightChartGeometry, type WeightChartPoint } from './weightChartPath';

export type WeightChartProps = {
  entries: readonly WeightEntry[];
  width: number;
  height: number;
  timezone: string;
  active: boolean;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const drawDuration = 600;

export function WeightChart(props: WeightChartProps): ReactElement {
  if (props.entries.length < 2) return <Text color="textMuted">{strings.weights.empty}</Text>;
  return <Chart {...props} />;
}

function Chart({ entries, width, height, timezone, active }: WeightChartProps): ReactElement {
  const { color } = useTheme();
  const animationActive = useAnimationActive(active);
  const reduced = useReduceMotion();
  const gradientId = `weight-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const geometry = useMemo(() => weightChartGeometry(entries, width, height), [entries, width, height]);
  const xs = useMemo(() => geometry.points.map((point) => point.x), [geometry]);
  const started = useRef(false);
  const progress = useSharedValue(reduced ? 1 : 0);
  const selected = useSharedValue(-1);
  const enabled = useSharedValue(false);
  const [selection, setSelection] = useState<{ entry: WeightEntry; geometry: WeightChartGeometry } | null>(null);
  if (selection !== null && (!animationActive || selection.geometry !== geometry)) setSelection(null);
  const entry = selection?.entry ?? null;

  useLayoutEffect(() => {
    enabled.set(animationActive);
    selected.set(-1);
    cancelAnimation(progress);
    if (animationActive && !started.current && geometry.points.length >= 2) {
      started.current = true;
      progress.set(reduced ? 1 : withTiming(1, { duration: drawDuration, easing: Easing.linear }));
    } else if (started.current || reduced) {
      progress.set(1);
    }
    return () => {
      enabled.set(false);
      selected.set(-1);
      cancelAnimation(progress);
    };
  }, [animationActive, reduced, geometry, progress, enabled, selected]);

  const announceSnap = useCallback((index: number) => {
    if (!enabled.get()) return;
    const point = geometry.points[index];
    const next = point === undefined ? null : entries[point.index] ?? null;
    setSelection(next === null ? null : { entry: next, geometry });
    if (next !== null) void impactAsync(ImpactFeedbackStyle.Light);
  }, [entries, geometry, enabled]);
  const snap = useCallback((x: number) => {
    'worklet';
    if (!enabled.get() || xs.length === 0) return;
    let nearest = 0;
    let distance = Infinity;
    for (let index = 0; index < xs.length; index += 1) {
      const candidate = Math.abs((xs[index] ?? 0) - x);
      if (candidate < distance) { nearest = index; distance = candidate; }
    }
    if (selected.get() !== nearest) {
      selected.set(nearest);
      scheduleOnRN(announceSnap, nearest);
    }
  }, [enabled, selected, xs, announceSnap]);
  const gesture = useMemo(() => Gesture.Pan().enabled(animationActive)
    .activeOffsetX([-spacing.xxs, spacing.xxs]).failOffsetY([-spacing.xs, spacing.xs])
    .withTestId('weight-chart-pan')
    .onStart((event) => { snap(event.x); })
    .onUpdate((event) => { snap(event.x); }), [animationActive, snap]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: (1 - progress.get()) * geometry.length }));
  const fillProps = useAnimatedProps(() => ({ opacity: progress.get() }));
  const markerProps = useAnimatedProps(() => {
    const x = xs[selected.get()] ?? 0;
    return { x1: x, x2: x, opacity: selected.get() < 0 ? 0 : 1 };
  });
  const first = geometry.points[0];
  const last = geometry.points.at(-1);
  const fill = first === undefined || last === undefined ? ''
    : `${geometry.path} L${last.x} ${height} L${first.x} ${height} Z`;
  return <View style={{ width, gap: spacing.xs }}>
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>
        <Svg testID="weight-chart" width={width} height={height} style={{ overflow: 'visible' }}>
          <Defs>
            <LinearGradient id={gradientId} x1={0} y1={0} x2={0} y2={height} gradientUnits="userSpaceOnUse">
              <Stop offset={0} stopColor={color.accentSoft} stopOpacity={1} />
              <Stop offset={1} stopColor={color.accentSoft} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <AnimatedPath d={fill} fill={`url(#${gradientId})`} animatedProps={fillProps} />
          <AnimatedPath testID="weight-chart-line" d={geometry.path} fill="none" stroke={color.accent}
            strokeWidth={icon.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={[geometry.length, geometry.length]} animatedProps={lineProps} />
          {geometry.points.map((point) => <MeasurementStar key={entries[point.index]?.id ?? point.index}
            point={point} progress={progress} length={geometry.length} color={color.accent} />)}
          <AnimatedLine testID="weight-chart-marker" y1={0} y2={height} stroke={color.textMuted}
            strokeWidth={icon.strokeWidth} animatedProps={markerProps} />
        </Svg>
      </View>
    </GestureDetector>
    <Text testID="weight-chart-value" variant="caption" style={{ minHeight: typography.caption.lineHeight }}>
      {entry === null ? '' : strings.weights.measurement(formatDecimal(entry.weight_kg, 2),
        formatShortDate(localDate(Date.parse(entry.measured_at), timezone)))}
    </Text>
  </View>;
}

function MeasurementStar({ point, progress, length, color }: {
  point: WeightChartPoint; progress: SharedValue<number>; length: number; color: string;
}): ReactElement {
  const animatedProps = useAnimatedProps(() => ({ opacity: progress.get() * length >= point.distance ? 1 : 0 }));
  return <AnimatedPath testID={`weight-chart-star-${point.index}`} d={starPath(point.x, point.y, spacing.xxs)}
    fill={color} animatedProps={animatedProps} />;
}
