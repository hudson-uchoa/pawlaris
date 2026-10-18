import { useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { strings } from '../../i18n/strings';
import type { ConnectionObservable } from '../../sync/engine';
import { crescentPath, sparklePath } from '../../ui/cosmos/glyphs';
import { ambient } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';
import { shell } from './tokens';

export type SyncIndicatorProps = {
  connection: ConnectionObservable;
  active: boolean;
};

export function SyncIndicator({ connection, active }: SyncIndicatorProps): ReactElement | null {
  const { status, server, outboxCount } = useSyncExternalStore(connection.subscribe, connection.getState);
  const { color } = useTheme();
  const animationActive = useAnimationActive(active);
  const reduced = useReduceMotion();
  const angle = useSharedValue(0);
  const center = shell.syncSize / 2;
  const ringRadius = center - shell.syncStroke / 2;
  useEffect(() => {
    angle.set(0);
    if (status === 'syncing' && animationActive && !reduced) {
      angle.set(withRepeat(withTiming(2 * Math.PI, { duration: ambient.syncOrbit, easing: Easing.linear }), -1, false));
    }
    return () => { cancelAnimation(angle); };
  }, [status, animationActive, reduced, angle]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [
    { translateX: Math.cos(angle.get() - Math.PI / 2) * ringRadius },
    { translateY: Math.sin(angle.get() - Math.PI / 2) * ringRadius },
  ] }));
  if (status === 'signed_out') return null;
  const label = strings.sync[status]
    + (status === 'syncing' && outboxCount > 0 ? ` (${outboxCount})` : '')
    + (status !== 'offline' && server === 'reserve' ? strings.sync.reserveSuffix : '');
  const ink = status === 'offline' ? color.textMuted : status === 'synced' ? color.success : color.star;
  return <View testID="sync-indicator" accessible accessibilityLabel={label}
    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
    <View accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ width: shell.syncSize, height: shell.syncSize }}>
      <Svg width={shell.syncSize} height={shell.syncSize} accessible={false}>
        {status === 'synced' ? <Path d={sparklePath(center, center, center)} fill={ink} />
          : status === 'offline' ? <Path d={crescentPath(center, center, center)} fill={ink} />
            : <Circle cx={center} cy={center} r={ringRadius} stroke={ink} strokeWidth={shell.syncStroke} fill="none" />}
      </Svg>
      {status === 'syncing' && <Animated.View testID="sync-indicator-dot" style={[{
        position: 'absolute', left: center - shell.syncDot / 2, top: center - shell.syncDot / 2,
        width: shell.syncDot, height: shell.syncDot, borderRadius: radius.avatar, backgroundColor: ink,
      }, dotStyle]} />}
    </View>
    <Text variant="caption" color={status === 'offline' ? 'textMuted' : 'text'}>{label}</Text>
  </View>;
}
