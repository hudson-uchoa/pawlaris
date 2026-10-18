import { useEffect, useRef, type ReactElement } from 'react';
import { CalendarDays, PawPrint, Route, Settings } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { sparklePath } from '../../ui/cosmos/glyphs';
import { spring } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Icon } from '../../ui/primitives/Icon';
import { useTheme } from '../../ui/theme';
import { shell } from './tokens';

export type TabName = 'index' | 'pets' | 'walks' | 'settings';
export type TabIconProps = { name: TabName; focused: boolean; active: boolean };

const glyphs = { index: CalendarDays, pets: PawPrint, walks: Route, settings: Settings };

export function TabIcon({ name, focused, active }: TabIconProps): ReactElement {
  const { color } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active);
  const scale = useSharedValue(focused ? 1 : 0);
  const previousFocused = useRef(focused);
  useEffect(() => {
    const selected = focused && !previousFocused.current;
    previousFocused.current = focused;
    scale.set(selected && animationActive && !reduced ? withSpring(1, spring.bouncy) : focused ? 1 : 0);
    return () => { cancelAnimation(scale); };
  }, [focused, animationActive, reduced, scale]);
  const starStyle = useAnimatedStyle(() => ({ transform: [
    { scale: reduced || !animationActive ? (focused ? 1 : 0) : scale.get() },
  ] }));
  return <View accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ alignItems: 'center', gap: shell.tabIconGap }}>
    <Icon glyph={glyphs[name]} size={shell.tabIconSize} color={focused ? 'star' : 'textMuted'} />
    <Animated.View testID={`tab-${name}-star`} style={starStyle}>
      <Svg width={shell.tabStarSize} height={shell.tabStarSize} accessible={false}>
        <Path d={sparklePath(shell.tabStarSize / 2, shell.tabStarSize / 2, shell.tabStarSize / 2)} fill={color.star} />
      </Svg>
    </Animated.View>
  </View>;
}
