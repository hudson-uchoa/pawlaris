import { useIsFocused } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { strings } from '../src/i18n/strings';
import { ConstellationLine } from '../src/ui/cosmos/ConstellationLine';
import { ShootingStars } from '../src/ui/cosmos/ShootingStars';
import { StarCheck } from '../src/ui/cosmos/StarCheck';
import { Starfield } from '../src/ui/cosmos/Starfield';
import { Text } from '../src/ui/primitives/Text';
import { useTheme } from '../src/ui/theme';
import { accessibility } from '../src/ui/tokens/accessibility';
import { radius } from '../src/ui/tokens/radius';
import { spacing } from '../src/ui/tokens/spacing';

// P4-2 device scratch screen. P4-3 replaces this route with the auth gate.
export default function Index(): ReactElement {
  const { width, height } = useWindowDimensions();
  const { color } = useTheme();
  const active = useIsFocused();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.set(event.contentOffset.y); });
  const [sample, setSample] = useState({ checked: false, ignitions: 0 });
  const lineWidth = Math.max(0, width - 2 * spacing.lg);
  const lineHeight = accessibility.minTouchTarget;
  const points = [spacing.xl, lineWidth / 2, lineWidth - spacing.xl]
    .map((x) => ({ x, y: lineHeight / 2 }));

  return <View style={{ flex: 1, backgroundColor: color.bg }}>
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Starfield seed={42} width={width} height={height} active={active} density="full" nebula scrollY={scrollY}>
        <ShootingStars width={width} height={height} active={active} play={sample.checked} />
      </Starfield>
    </View>
    <Animated.ScrollView testID="cosmos-scratch" onScroll={onScroll} scrollEventThrottle={16}
      contentContainerStyle={{ minHeight: 2 * height, paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xxl, gap: spacing.lg }}>
      <Text variant="display">{strings.appName}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <StarCheck testID="scratch-check" active={active} checked={sample.checked}
          accessibilityLabel={strings.appName}
          onPress={() => { setSample((previous) => ({ checked: !previous.checked,
            ignitions: previous.ignitions + (previous.checked ? 0 : 1) })); }} />
        <Text variant="label">{`${sample.ignitions}/10`}</Text>
      </View>
      <View style={{ width: lineWidth, height: lineHeight }}>
        <ConstellationLine testID="scratch-constellation" width={lineWidth} height={lineHeight}
          points={points} active={active} complete={sample.checked} />
        {points.map((point) => <View key={point.x} pointerEvents="none" accessible={false}
          style={{ position: 'absolute', left: point.x - spacing.xxs / 2, top: point.y - spacing.xxs / 2,
            width: spacing.xxs, height: spacing.xxs, borderRadius: radius.avatar,
            backgroundColor: sample.checked ? color.star : color.textMuted }} />)}
      </View>
    </Animated.ScrollView>
  </View>;
}
