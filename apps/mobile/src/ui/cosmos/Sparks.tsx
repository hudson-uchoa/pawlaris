import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { sparks } from '../tokens/cosmos';
import { sparklePath } from './glyphs';

export type SparksProps = {
  progress: SharedValue<number>;
  active: boolean;
  testID?: string;
};

const angles = Array.from({ length: sparks.count }, (_, index) =>
  sparks.firstAngle + index * 2 * Math.PI / sparks.count);
const sparkPath = sparklePath(sparks.size / 2, sparks.size / 2, sparks.size / 2);

const Spark = memo(function Spark({ progress, angle, color }: {
  progress: SharedValue<number>; angle: number; color: string;
}): ReactElement {
  const style = useAnimatedStyle(() => {
    const fraction = progress.get();
    return {
      opacity: 1 - fraction,
      transform: [
        { translateX: Math.cos(angle) * sparks.distance * fraction },
        { translateY: Math.sin(angle) * sparks.distance * fraction },
        { scale: 1 - fraction },
      ],
    };
  });
  return <Animated.View style={[{
    position: 'absolute', left: '50%', top: '50%',
    marginLeft: -sparks.size / 2, marginTop: -sparks.size / 2,
    width: sparks.size, height: sparks.size,
  }, style]}>
    <Svg width={sparks.size} height={sparks.size} accessible={false}>
      <Path d={sparkPath} fill={color} />
    </Svg>
  </Animated.View>;
});

export function Sparks({ progress, active, testID }: SparksProps): ReactElement | null {
  const { color } = useTheme();
  const animationActive = useAnimationActive(active);
  const reduced = useReduceMotion();
  if (!animationActive || reduced) return null;
  return <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none"
    accessible={false} importantForAccessibility="no-hide-descendants">
    {angles.map((angle) => <Spark key={angle} progress={progress} angle={angle} color={color.star} />)}
  </View>;
}
