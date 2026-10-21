import { identityIndexForId, identityIndexForKey } from '@pawlaris/shared';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { ambient } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { identity } from '../tokens/color';
import { orbit } from '../tokens/cosmos';
import { radius } from '../tokens/radius';

export type OrbitProps = {
  petId: string;
  identityColor?: string | null;
  size: number;
  active: boolean;
  children?: ReactNode;
  satellite?: boolean;
  testID?: string;
};

export function Orbit({ petId, identityColor = null, size, active, children, satellite = false,
  testID }: OrbitProps): ReactElement {
  const { scheme } = useTheme();
  const index = identityColor === null ? identityIndexForId(petId) : identityIndexForKey(identityColor);
  const entry = identity[index] ?? identity[0];
  const color = entry[scheme];
  const animationActive = useAnimationActive(active);
  const reduced = useReduceMotion();
  const angle = useSharedValue(0);
  const ringRadius = Math.max(0, size / 2 - orbit.ringInset);
  useEffect(() => {
    angle.set(0);
    if (satellite && animationActive && !reduced) {
      angle.set(withRepeat(withTiming(2 * Math.PI, { duration: ambient.orbit, easing: Easing.linear }), -1, false));
    }
    return () => { cancelAnimation(angle); };
  }, [satellite, animationActive, reduced, angle]);
  const satelliteStyle = useAnimatedStyle(() => ({ transform: [
    { translateX: Math.cos(angle.get() + orbit.firstAngle) * ringRadius },
    { translateY: Math.sin(angle.get() + orbit.firstAngle) * ringRadius },
  ] }));
  return <View testID={testID} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    {children}
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}
      importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} accessible={false}>
        <Circle cx={size / 2} cy={size / 2} r={ringRadius} fill="none" stroke={color} strokeWidth={orbit.strokeWidth} />
      </Svg>
      {satellite && !reduced && <Animated.View
        testID={testID === undefined ? undefined : `${testID}-satellite`}
        style={[{ position: 'absolute', left: size / 2 - orbit.satelliteSize / 2,
          top: size / 2 - orbit.satelliteSize / 2, width: orbit.satelliteSize, height: orbit.satelliteSize,
          backgroundColor: color, borderRadius: radius.avatar }, satelliteStyle]} />}
    </View>
  </View>;
}
