import { useEffect, useId, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { ambient } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { insurge } from '../tokens/color';
import { signature } from '../tokens/cosmos';
import { insurgeMark } from './glyphs';

export type InsurgeMarkProps = {
  active: boolean;
  testID?: string;
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function InsurgeMark({ active, testID }: InsurgeMarkProps): ReactElement {
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active);
  const opacity = useSharedValue(1);
  const gradientId = useId();
  useEffect(() => {
    opacity.set(1);
    if (animationActive && !reduced) {
      opacity.set(signature.ringMinOpacity);
      opacity.set(withRepeat(withTiming(1, { duration: ambient.breath / 2 }), -1, true));
    }
    return () => { cancelAnimation(opacity); };
  }, [animationActive, reduced, opacity]);
  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.get() }));
  const { center } = insurgeMark;
  const rotation = `rotate(${insurgeMark.rotation} ${center.x} ${center.y})`;
  return <View testID={testID} accessible={false} importantForAccessibility="no-hide-descendants"
    pointerEvents="none" style={{ width: signature.markSize, height: signature.markSize }}>
    <Svg width={signature.markSize} height={signature.markSize}
      viewBox={`0 0 ${2 * center.x} ${2 * center.y}`} accessible={false}>
      <Defs><LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%" stopColor={insurge.deep} />
        <Stop offset="50%" stopColor={insurge.violet} />
        <Stop offset="100%" stopColor={insurge.lavender} />
      </LinearGradient></Defs>
      <G fill="none" strokeLinecap="round">
        <Path d={insurgeMark.back} transform={rotation} stroke={`url(#${gradientId})`}
          strokeWidth={insurgeMark.arcStroke} opacity={insurgeMark.backOpacity} />
        <AnimatedCircle cx={center.x} cy={center.y} r={insurgeMark.ringRadius}
          stroke={insurge.glow} strokeWidth={insurgeMark.ringStroke} animatedProps={animatedProps} />
        <Circle cx={center.x} cy={center.y} r={insurgeMark.horizonRadius} fill={insurge.void} />
        <Path d={insurgeMark.front} transform={rotation} stroke={`url(#${gradientId})`}
          strokeWidth={insurgeMark.arcStroke} />
      </G>
    </Svg>
  </View>;
}
