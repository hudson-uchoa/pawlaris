import { Atlas, BlurMask, Canvas, Circle, Fill, Group, Path, Picture, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { cancelAnimation, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { ambient } from '../motion/tokens';
import { useAnimationActive } from '../motion/useAnimationActive';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { morningStarTint, shootingStars, starfield } from '../tokens/cosmos';
import { CelebrationContext, celebrationBrightness } from './celebration';
import { sparklePath } from './glyphs';
import { generateSky, starAlpha, starDepth, starRadius, type SkyPlanet, type SkyStar } from './sky';
import { SkyEvents } from './SkyEvents';
import { skyClock } from './skyClock';
import { recordSky, renderGlowSprite, transparentColor } from './skyPicture';

export type StarfieldProps = {
  seed: number;
  width: number;
  height: number;
  active: boolean;
  density?: 'header' | 'band' | 'full';
  nebula?: boolean;
  fadeEdges?: boolean;
  scrollY?: SharedValue<number>;
  children?: ReactNode;
  testID?: string;
};

const BrightStar = memo(function BrightStar({ star, time, scroll, tint, dawn }: {
  star: SkyStar; time: SharedValue<number>; scroll: SharedValue<number>; tint: string; dawn: boolean;
}): ReactElement {
  const radius = starRadius(star.magnitude);
  const opacity = useDerivedValue(() => starAlpha(star, time.get()) * (dawn ? starfield.lightOpacity : 1));
  const halo = useDerivedValue(() => opacity.get() * starfield.halo.alpha);
  const y = useDerivedValue(() => star.y - scroll.get() * starDepth(star.magnitude));
  const transform = useDerivedValue(() => [{ translateY: -scroll.get() * starDepth(star.magnitude) }]);
  const path = useMemo(() => sparklePath(star.x, star.y, radius * starfield.spikes.radius), [star, radius]);
  return <>
    <Circle cx={star.x} cy={y} r={radius * starfield.halo.radius} opacity={halo}>
      <RadialGradient c={vec(star.x, star.y)} r={radius * starfield.halo.radius}
        transform={transform} colors={[tint, transparentColor(tint)]} />
    </Circle>
    {star.magnitude === 1 && <Group transform={transform}><Path path={path} color={tint} opacity={opacity} /></Group>}
  </>;
});

export function Starfield({ seed, width, height, active, density = 'header', nebula = true,
  fadeEdges = false, scrollY, children, testID }: StarfieldProps): ReactElement {
  const { color, scheme } = useTheme();
  const reduced = useReduceMotion();
  const animationActive = useAnimationActive(active);
  const enabled = animationActive && !reduced && width > 0 && height > 0;
  const dawn = scheme === 'light';
  const time = useSharedValue(0);
  const scroll = useSharedValue(0);
  useEffect(() => {
    if (enabled) time.set(skyClock(scroll, height, scrollY));
    return () => { cancelAnimation(time); };
  }, [enabled, time, height, scroll, scrollY]);
  const celebrationTime = useSharedValue<number>(shootingStars.duration);
  const celebration = useMemo(() => ({ time: celebrationTime, active: animationActive }),
    [celebrationTime, animationActive]);
  const sky = useMemo(() => generateSky(seed, { width, height, density: density === 'full' ? 'full' : 'band' }),
    [seed, width, height, density]);
  const picture = useMemo(() => recordSky(sky, width, height, color, !dawn && density === 'full'),
    [sky, width, height, color, dawn, density]);
  const image = useMemo(() => renderGlowSprite(), []);
  const stars = useMemo(() => dawn ? sky.stars.filter((star) => star.magnitude <= 2) : sky.stars, [sky, dawn]);
  const rgb = useMemo(() => stars.map((star) => Skia.Color(dawn ? color.starfield : star.tint)), [stars, dawn, color]);
  const sprites = useMemo(() => stars.map(() => Skia.XYWHRect(0, 0, starfield.sprite.size, starfield.sprite.size)), [stars]);
  const transforms = useDerivedValue(() => stars.map((star) => {
    const scale = starRadius(star.magnitude) / starfield.sprite.radius;
    const inset = starfield.sprite.size * scale / 2;
    return Skia.RSXform(scale, 0, star.x - inset, star.y - inset - scroll.get() * starDepth(star.magnitude));
  }));
  const hasChildren = children != null;
  const colors = useDerivedValue(() => {
    const brightness = hasChildren ? celebrationBrightness(celebrationTime.get()) : 0;
    return stars.map((star, index) => {
      const alpha = starAlpha(star, time.get()) * (dawn ? starfield.lightOpacity : 1);
      const tint = rgb[index];
      return Float32Array.of(tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1, alpha + (1 - alpha) * brightness);
    });
  });
  const nebulaOpacity = useDerivedValue(() => starfield.nebula.minimum
    + (starfield.nebula.maximum - starfield.nebula.minimum)
      * (0.5 + 0.5 * Math.sin(2 * Math.PI * time.get() / ambient.nebula)));
  const planetY = useDerivedValue(() => -scroll.get() * starfield.parallax[0]);
  return <Canvas testID={testID} style={{ width, height }} pointerEvents="none"
    accessible={false} importantForAccessibility="no-hide-descendants">
    <CelebrationContext.Provider value={celebration}>
      <Group layer={fadeEdges}>
        <Picture picture={picture} />
        {nebula && starfield.nebula.clouds.map((cloud) => {
          const center = vec(width * cloud.x, height * cloud.y);
          const radius = Math.max(width, height) * cloud.radius;
          return <Circle key={cloud.color} c={center} r={radius} opacity={nebulaOpacity}>
            <RadialGradient c={center} r={radius} colors={[color[cloud.color], transparentColor(color[cloud.color])]} />
            <BlurMask style="normal" blur={Math.min(width, height) * starfield.nebula.blurSigma} />
          </Circle>;
        })}
        <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
        {stars.filter((star) => star.magnitude <= 2).map((star, index) => <BrightStar key={index}
          star={star} time={time} scroll={scroll} tint={dawn ? color.starfield : star.tint} dawn={dawn} />)}
        {!fadeEdges && (dawn
          ? <Circle cx={width * starfield.morning.x} cy={height * starfield.morning.y}
              r={starfield.morning.radius} color={morningStarTint} opacity={starfield.morning.alpha} />
          : sky.planets.map((planet, index) => <Planet key={index} planet={planet} offset={planetY} />))}
        {!dawn && !reduced && !fadeEdges && <SkyEvents seed={seed} width={width} height={height} time={time} />}
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

function Planet({ planet, offset }: { planet: SkyPlanet; offset: SharedValue<number> }): ReactElement {
  const y = useDerivedValue(() => planet.y + offset.get());
  const alpha = starfield.planet.alpha[0] + (planet.radius - starfield.planet.radius[0])
    / (starfield.planet.radius[1] - starfield.planet.radius[0]) * (starfield.planet.alpha[1] - starfield.planet.alpha[0]);
  return <Circle cx={planet.x} cy={y} r={planet.radius} color={planet.tint} opacity={alpha} />;
}
