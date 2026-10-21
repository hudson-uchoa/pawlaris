import { memo, useEffect, type ReactElement } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Text } from '../../ui/primitives/Text';
import { accessibility } from '../../ui/tokens/accessibility';
import { typography } from '../../ui/tokens/type';

export function RollingDistance({ value, active }: { value: string; active: boolean }): ReactElement {
  const reduced = useReduceMotion();
  const enabled = useAnimationActive(active);
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, accessibility.maxFontSizeMultiplier);
  const height = typography.display.lineHeight * scale;
  return <View accessible accessibilityLabel={value} style={{ alignSelf: 'flex-start' }}>
    {/* One semantic value, independent of the decorative digit rails. */}
    <Text testID="walk-distance" variant="display" style={{ opacity: reduced ? 1 : 0,
      fontVariant: ['tabular-nums'] }}>{value}</Text>
    {!reduced && <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
      {[...value].map((character, index) => /[0-9]/.test(character)
        ? <RollingDigit key={`${value.length - index}`} digit={Number(character)} active={enabled}
          testID={`walk-distance-digit-${value.length - index}`}
          height={height} width={typography.display.fontSize * scale * 0.65} />
        : <Text key={`${value.length - index}`} variant="display">{character}</Text>)}
    </View>}
  </View>;
}

const RollingDigit = memo(function RollingDigit({ digit, active, height, width, testID }: {
  digit: number; active: boolean; height: number; width: number; testID: string;
}): ReactElement {
  const position = useSharedValue(digit * height);
  useEffect(() => {
    cancelAnimation(position);
    const target = digit * height;
    position.set(active && position.get() !== target ? withTiming(target, { duration: duration.quick }) : target);
    return () => { cancelAnimation(position); };
  }, [digit, height, active, position]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -position.get() }] }));
  return <View style={{ width, height, overflow: 'hidden' }}>
    <Animated.View testID={testID} style={style}>
      {Array.from({ length: 10 }, (_, value) => <Text key={value} variant="display"
        style={{ height, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{value}</Text>)}
    </Animated.View>
  </View>;
});
