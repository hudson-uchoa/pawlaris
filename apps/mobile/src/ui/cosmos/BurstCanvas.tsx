import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';
import { useEffect, useMemo, type ReactElement } from 'react';
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme';
import { burst, starCheck } from '../tokens/cosmos';
import { sparklePath } from './glyphs';
import { generateStarBurst, type BurstParticle } from './starBurst';

function Particle({ particle, time, color }: {
  particle: BurstParticle; time: SharedValue<number>; color: string;
}): ReactElement {
  const center = burst.canvasSize / 2;
  const transform = useDerivedValue(() => {
    const seconds = time.get() / 1000;
    const distance = particle.speed * (1 - Math.exp(-burst.drag * seconds)) / burst.drag;
    return [{ translateX: Math.cos(particle.angle) * distance },
      { translateY: Math.sin(particle.angle) * distance + burst.gravity * seconds * seconds / 2 }];
  });
  const opacity = useDerivedValue(() => Math.max(0, 1 - time.get() / burst.duration));
  const path = useMemo(() => sparklePath(center, center, particle.size), [center, particle.size]);
  return <Group transform={transform} opacity={opacity}>
    {particle.kind === 'sparkle' ? <Path path={path} color={color} />
      : <Circle cx={center} cy={center} r={particle.size} color={color} />}
  </Group>;
}

export function StarBurstCanvas({ occurrenceKey, testID, onDone }: {
  occurrenceKey: string; testID?: string; onDone: () => void;
}): ReactElement {
  const { color } = useTheme();
  const generated = useMemo(() => generateStarBurst(occurrenceKey), [occurrenceKey]);
  const time = useSharedValue(0);
  useEffect(() => {
    time.set(withTiming(burst.duration, { duration: burst.duration, easing: Easing.linear }, (finished) => {
      if (finished) scheduleOnRN(onDone);
    }));
    return () => { cancelAnimation(time); };
  }, [onDone, time]);
  const ringRadius = useDerivedValue(() => generated.ring.fromRadius
    + (generated.ring.toRadius - generated.ring.fromRadius) * Math.min(1, time.get() / generated.ring.duration));
  const ringOpacity = useDerivedValue(() => generated.ring.alpha * Math.max(0, 1 - time.get() / generated.ring.duration));
  return <Canvas testID={testID} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', width: burst.canvasSize, height: burst.canvasSize,
      left: (starCheck.size - burst.canvasSize) / 2, top: (starCheck.size - burst.canvasSize) / 2 }}>
    {generated.particles.map((particle, index) => <Particle key={index} particle={particle} time={time}
      color={particle.tint === 'star' ? color.star : particle.tint} />)}
    <Circle cx={burst.canvasSize / 2} cy={burst.canvasSize / 2} r={ringRadius} color={color.star}
      style="stroke" strokeWidth={generated.ring.strokeWidth} opacity={ringOpacity} />
  </Canvas>;
}
