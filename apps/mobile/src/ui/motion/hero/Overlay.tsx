import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type MeasuredDimensions, type SharedValue } from 'react-native-reanimated';
import type { Frames, HeroContent } from './types';

type Motion = {
  progress: SharedValue<number>;
  destination: SharedValue<Frames | null>;
  opacity: SharedValue<number>;
  origin: SharedValue<{ x: number; y: number }>;
};

function Copy({ children, base, from, part, progress, destination, origin }: Motion & {
  children: ReactNode; base: MeasuredDimensions; from: MeasuredDimensions; part: keyof Frames;
}) {
  const style = useAnimatedStyle(() => {
    const to = destination.get()?.[part] ?? from;
    const fraction = progress.get();
    return {
      position: 'absolute', width: base.width, height: base.height,
      left: from.pageX - origin.get().x, top: from.pageY - origin.get().y,
      transformOrigin: [0, 0, 0],
      transform: [
        { translateX: (to.pageX - from.pageX) * fraction },
        { translateY: (to.pageY - from.pageY) * fraction },
        { scaleX: (from.width + (to.width - from.width) * fraction) / base.width },
        { scaleY: (from.height + (to.height - from.height) * fraction) / base.height },
      ],
    };
  });
  return <Animated.View testID={`hero-overlay-${part}`} style={style}>{children}</Animated.View>;
}

export function Overlay({ content, base, from, ...motion }: Motion & {
  content: HeroContent; base: Frames; from: Frames;
}) {
  const { opacity } = motion;
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View testID="hero-overlay" pointerEvents="none" accessible={false}
    importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, style]}>
    <Copy {...motion} base={base.avatar} from={from.avatar} part="avatar">{content.avatar}</Copy>
    <Copy {...motion} base={base.name} from={from.name} part="name">{content.name}</Copy>
  </Animated.View>;
}
