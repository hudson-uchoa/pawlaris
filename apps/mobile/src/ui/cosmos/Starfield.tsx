import { BlurMask, Canvas, Circle, Fill, Group, LinearGradient, Points, RadialGradient, Skia, vec, type SkPoint } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { cancelAnimation, clamp, Easing, useDerivedValue, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { ambient } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { shootingStars, starfield } from '../tokens/cosmos';
import { CelebrationContext, celebrationBrightness } from './celebration';
import { generateStars, starLayers, type StarLayer } from './stars';

export type StarfieldProps = {
  seed: number;
  width: number;
  height: number;
  active: boolean;
  density?: 'header' | 'full';
  nebula?: boolean;
  fadeEdges?: boolean;
  scrollY?: SharedValue<number>;
  children?: ReactNode;
  testID?: string;
};

const twinklePeriods = [ambient.twinkleA, ambient.twinkleB, ambient.twinkleC] as const;

type ParallaxLayerProps = {
  scrollY: SharedValue<number>;
  height: number;
  factor: number;
  children: ReactElement;
};

function ParallaxLayer({ scrollY, height, factor, children }: ParallaxLayerProps): ReactElement {
  const transform = useDerivedValue(() => [{ translateY: -clamp(scrollY.get(), 0, height) * factor }],
    [scrollY, height, factor]);
  return <Group transform={transform}>{children}</Group>;
}

type StarLayerDrawingProps = {
  layer: StarLayer;
  points: SkPoint[];
  color: string;
  themeOpacity: number;
  enabled: boolean;
  height: number;
  scrollY: SharedValue<number> | undefined;
  celebration: SharedValue<number> | undefined;
};

const StarLayerDrawing = memo(function StarLayerDrawing({ layer, points, color, themeOpacity,
  enabled, height, scrollY, celebration }: StarLayerDrawingProps): ReactElement {
  const twinkle = useSharedValue(1);
  const period = twinklePeriods[layer];
  const paint = starLayers[layer];
  useEffect(() => {
    twinkle.set(1);
    if (enabled) {
      // A full period includes the dimming and its reversed return.
      twinkle.set(withRepeat(withTiming(starfield.twinkleMin,
        { duration: period / 2, easing: Easing.inOut(Easing.sin) }), -1, true));
    }
    return () => { cancelAnimation(twinkle); };
  }, [enabled, period, twinkle]);

  const opacity = useDerivedValue(() => {
    if (celebration === undefined) return 1;
    const ordinary = paint.opacity * themeOpacity * twinkle.get();
    const brightness = celebrationBrightness(celebration.get());
    return ordinary + (1 - ordinary) * brightness;
  }, [celebration, twinkle, paint.opacity, themeOpacity]);
  // Without scene children, use the ambient paint directly. Scene effects
  // can raise combined opacity to 1 without adding another points draw.
  const stars = <Points points={points} mode="points" color={color}
    strokeWidth={2 * paint.radius} strokeCap="round" opacity={celebration === undefined ? twinkle : opacity} />;
  return <Group opacity={celebration === undefined ? paint.opacity * themeOpacity : 1}>
    {enabled && scrollY !== undefined
      ? <ParallaxLayer scrollY={scrollY} height={height} factor={paint.parallax}>{stars}</ParallaxLayer>
      : stars}
  </Group>;
});

function transparentColor(token: string): Float32Array {
  const color = Skia.Color(token);
  color[3] = 0;
  return color;
}

export function Starfield({ seed, width, height, active, density = 'header', nebula = false,
  fadeEdges = false, scrollY, children, testID }: StarfieldProps): ReactElement {
  const { color, scheme } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active);
  const celebrationTime = useSharedValue<number>(shootingStars.duration);
  const celebration = useMemo(() => ({ time: celebrationTime, active: animationActive }),
    [celebrationTime, animationActive]);
  const enabled = animationActive && !reduced && width > 0 && height > 0;
  const count = starfield.count[density];
  const layers = useMemo(() => {
    const points: [SkPoint[], SkPoint[], SkPoint[]] = [[], [], []];
    for (const { x, y, layer } of generateStars(seed, count, width, height)) {
      points[layer].push({ x, y });
    }
    return points;
  }, [seed, count, width, height]);
  const themeOpacity = scheme === 'light' ? starfield.lightOpacity : 1;
  return <Canvas testID={testID} style={{ width, height }} pointerEvents="none"
    accessible={false} importantForAccessibility="no-hide-descendants">
    <CelebrationContext.Provider value={celebration}>
    <Group layer={fadeEdges}>
    <Fill><LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[color.skyTop, color.skyBottom]} /></Fill>
    {nebula && starfield.nebula.clouds.map((cloud) => {
      const center = vec(width * cloud.x, height * cloud.y);
      const radius = Math.max(width, height) * cloud.radius;
      return <Circle key={cloud.color} c={center} r={radius} opacity={starfield.nebula.opacity}>
        <RadialGradient c={center} r={radius} colors={[color[cloud.color], transparentColor(color[cloud.color])]} />
        <BlurMask style="normal" blur={Math.min(width, height) * starfield.nebula.blurSigma} />
      </Circle>;
    })}
    {starLayers.map(({ layer }) => <StarLayerDrawing key={layer} layer={layer} points={layers[layer]}
      color={color.starfield} themeOpacity={themeOpacity} enabled={enabled} height={height} scrollY={scrollY}
      celebration={children == null ? undefined : celebrationTime} />)}
    {children}
    {fadeEdges && <Fill blendMode="dstIn">
      <RadialGradient c={vec(width / 2, width / 2)} r={Math.max(1, width / 2)}
        transform={[{ scaleY: height / Math.max(1, width) }]}
        colors={[color.skyTop, color.skyTop, transparentColor(color.skyTop)]} positions={[0, 0.5, 1]} />
    </Fill>}
    </Group>
    </CelebrationContext.Provider>
  </Canvas>;
}
