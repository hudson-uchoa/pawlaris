import { Circle, Group, Path } from '@shopify/react-native-skia';
import { useMemo, type ReactElement } from 'react';
import { clamp, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { burst, starTints, supernova } from '../tokens/cosmos';
import { sparklePath } from './glyphs';
import { mulberry32 } from './random';
import type { BurstParticle } from './starBurst';

export interface SupernovaProps {
  time: SharedValue<number>;
  x: number;
  y: number;
  seed: number;
}

function Particle({ particle, time, x, y, color }: {
  particle: BurstParticle; time: SharedValue<number>; x: number; y: number; color: string;
}): ReactElement {
  const transform = useDerivedValue(() => {
    const seconds = clamp(time.get(), 0, burst.duration) / 1000;
    const distance = supernova.travelScale * particle.speed * (1 - Math.exp(-burst.drag * seconds)) / burst.drag;
    return [{ translateX: Math.cos(particle.angle) * distance },
      { translateY: Math.sin(particle.angle) * distance + supernova.travelScale * burst.gravity * seconds * seconds / 2 }];
  });
  const opacity = useDerivedValue(() => time.get() < 0 ? 0 : Math.max(0, 1 - time.get() / burst.duration));
  const path = useMemo(() => sparklePath(x, y, particle.size), [x, y, particle.size]);
  return <Group transform={transform} opacity={opacity}>
    {particle.kind === 'sparkle' ? <Path path={path} color={color} />
      : <Circle cx={x} cy={y} r={particle.size} color={color} />}
  </Group>;
}

function Shockwave({ time, x, y, delay, color }: {
  time: SharedValue<number>; x: number; y: number; delay: number; color: string;
}): ReactElement {
  const radius = useDerivedValue(() => burst.ring.fromRadius
    + (burst.ring.toRadius * supernova.travelScale - burst.ring.fromRadius)
      * clamp((time.get() - delay) / burst.ring.duration, 0, 1));
  const opacity = useDerivedValue(() => time.get() < delay ? 0
    : burst.ring.alpha * Math.max(0, 1 - (time.get() - delay) / burst.ring.duration));
  return <Circle cx={x} cy={y} r={radius} color={color} style="stroke"
    strokeWidth={burst.ring.strokeWidth} opacity={opacity} />;
}

// Draw nodes share ShootingStars' canvas and its finite UI-thread timeline.
export function Supernova({ time, x, y, seed }: SupernovaProps): ReactElement {
  const { color } = useTheme();
  const particles = useMemo(() => {
    const next = mulberry32(seed);
    const tints = [...starTints, 'star'] as const;
    return Array.from({ length: supernova.count }, (_, index): BurstParticle => ({
      kind: index < supernova.sparkles ? 'sparkle' : 'mote',
      angle: index * 2 * Math.PI / supernova.count + (next() * 2 - 1) * burst.jitter * Math.PI / 180,
      speed: burst.speed[0] + next() * (burst.speed[1] - burst.speed[0]),
      size: burst.size[0] + next() * (burst.size[1] - burst.size[0]),
      tint: tints[Math.floor(next() * tints.length)] ?? 'star',
    }));
  }, [seed]);
  return <Group>
    {particles.map((particle, index) => <Particle key={index} particle={particle} time={time}
      x={x} y={y} color={particle.tint === 'star' ? color.star : particle.tint} />)}
    <Shockwave time={time} x={x} y={y} delay={0} color={color.star} />
    <Shockwave time={time} x={x} y={y} delay={supernova.ringStagger} color={color.star} />
  </Group>;
}
