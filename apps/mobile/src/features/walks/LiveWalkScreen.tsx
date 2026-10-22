import { useContext, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatDecimal, formatDistance, formatDuration, formatPace } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { duration } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Button } from '../../ui/primitives/Button';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { createLiveWalkReader, type LiveWalkServices } from '../../walks/live';
import { RollingDistance } from './RollingDistance';
import { WalkMap } from './WalkMap';
import { routeForUpload } from '@pawlaris/shared';

export interface LiveWalkScreenProps {
  services: LiveWalkServices;
  active: boolean;
  onFinished(walkId: string): void;
  onDiscarded(): void;
  onLocationSettings(): void;
}

export function LiveWalkScreen({ services, active: focused, onFinished, onDiscarded,
  onLocationSettings }: LiveWalkScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const active = useAnimationActive(focused);
  const reduced = useReduceMotion();
  const read = useMemo(() => createLiveWalkReader(services), [services]);
  const [reading, setReading] = useState(() => ({ read, active, metrics: read() }));
  // A changed source or focus gets a fresh disk snapshot before painting.
  if (reading.read !== read || reading.active !== active) {
    setReading({ read, active, metrics: read() });
  }
  const metrics = reading.metrics;
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const action = useRef(false);
  const opacity = useSharedValue(metrics.walk?.state === 'paused' ? 0.6 : 1);
  const paused = metrics.walk?.state === 'paused';
  const route = useMemo(() => metrics.walk === null ? []
    : routeForUpload(services.points.read(metrics.walk.id)), [metrics, services.points]);
  useEffect(() => {
    if (!active) return;
    // Refresh persisted data and elapsed-time text; Reanimated owns all frames.
    const timer = setInterval(() => { setReading({ read, active, metrics: read() }); }, 1000);
    return () => { clearInterval(timer); };
  }, [active, read]);
  useEffect(() => {
    const target = paused ? 0.6 : 1;
    cancelAnimation(opacity);
    opacity.set(active && !reduced && opacity.get() !== target
      ? withTiming(target, { duration: duration.quick }) : target);
    return () => { cancelAnimation(opacity); };
  }, [paused, active, reduced, opacity]);
  const panelStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const complete = async (discard: boolean): Promise<void> => {
    if (action.current || !active) return;
    action.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (discard) {
        await services.discard();
        setSheet(false);
        onDiscarded();
      } else {
        const id = await services.finish();
        setSheet(false);
        onFinished(id);
      }
    } catch {
      action.current = false;
      setBusy(false);
      setFailed(true);
    }
  };
  const finishButton = <Button testID="walk-finish-confirm" label={strings.walks.finish}
    accessibilityLabel={strings.walks.finish} active={active} disabled={busy || !active}
    onPress={() => complete(false)} />;
  const trivial = metrics.distanceM < 20 || metrics.seconds < 30;
  return <View style={{ flex: 1, backgroundColor: color.bg, paddingTop: insets?.top ?? 0 }}>
    {metrics.walk === null ? <Skeleton width={spacing.xxl * 5} height={spacing.xxl * 2} active={active} /> : <>
      <WalkMap points={route} mode="live" active={active && !paused} />
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: spacing.lg,
        paddingBottom: spacing.lg + (insets?.bottom ?? 0), gap: spacing.md }}>
        {metrics.walk.trackingMode === 'foreground' && <PressableScale testID="walk-foreground-banner"
          accessibilityLabel={strings.walks.foregroundBanner} active={active} disabled={!active || busy}
          onPress={onLocationSettings} style={{ backgroundColor: color.accentSoft, padding: spacing.md }}>
          <Text>{strings.walks.foregroundBanner}</Text>
        </PressableScale>}
        <Animated.View testID="walk-metrics" style={[{ gap: spacing.sm }, panelStyle]}>
          <RollingDistance value={formatDistance(metrics.distanceM)} active={active} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <Text testID="walk-elapsed" style={{ fontVariant: ['tabular-nums'] }}>{formatDuration(metrics.seconds)}</Text>
            <Text testID="walk-pace" style={{ fontVariant: ['tabular-nums'] }}>{formatPace(metrics.pace)}</Text>
            <Text testID="walk-speed" style={{ fontVariant: ['tabular-nums'] }}>
              {`${formatDecimal(metrics.speed * 3.6, 1)} ${strings.walks.speedUnit}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={{ width: spacing.xs, height: spacing.xs, borderRadius: spacing.xs,
              backgroundColor: metrics.signal === 'good' ? color.success : color.warning }} />
            <Text testID="walk-signal" color="textMuted">{{ good: strings.walks.signalGood,
              weak: strings.walks.signalWeak, none: strings.walks.noSignal }[metrics.signal]}</Text>
          </View>
        </Animated.View>
        {failed && !sheet && <Text accessibilityRole="alert">{strings.settings.operationFailed}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <Button testID={paused ? 'walk-resume-live' : 'walk-pause'}
            label={paused ? strings.walks.resume : strings.walks.pause}
            accessibilityLabel={paused ? strings.walks.resume : strings.walks.pause}
            active={active} disabled={busy || !active} onPress={() => {
              if (paused) services.tracker.resume();
              else services.tracker.pause();
              setReading({ read, active, metrics: read() });
            }} />
          <Button testID="walk-finish" label={strings.walks.finish} accessibilityLabel={strings.walks.finish}
            active={active} disabled={busy || !active} onPress={() => { setSheet(true); }} />
        </View>
      </ScrollView>
    </>}
    <Sheet visible={sheet} active={active} testID="walk-finish-sheet"
      accessibilityLabel={strings.walks.finishTitle} dismissLabel={strings.dismiss}
      onDismiss={() => { if (!action.current) setSheet(false); }}>
      <Text variant="heading">{strings.walks.finishTitle}</Text>
      {trivial && <Button testID="walk-discard" label={strings.walks.discard}
        accessibilityLabel={strings.walks.discard} active={active} disabled={busy || !active}
        onPress={() => complete(true)} />}
      {finishButton}
      {failed && <Text accessibilityRole="alert">{strings.settings.operationFailed}</Text>}
    </Sheet>
  </View>;
}
