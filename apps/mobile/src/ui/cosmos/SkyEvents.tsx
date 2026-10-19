import { Circle, Line, LinearGradient, vec } from '@shopify/react-native-skia';
import { useMemo, type ReactElement } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { starfield } from '../tokens/cosmos';
import { mulberry32 } from './random';
import { generateSkyEventSchedule } from './sky';
import { transparentColor } from './skyPicture';

// Repeat the seeded interval stream, including the last event across the seam.
// This keeps a mounted sky alive indefinitely without a JS wakeup or timer.
export function scheduledEvent(time: number, starts: readonly number[]): { index: number; age: number } {
  'worklet';
  const span = starts[starts.length - 1] ?? 0;
  if (span <= 0) return { index: 0, age: -1 };
  const cycle = Math.floor(time / span);
  const local = time % span;
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((starts[middle] ?? Infinity) <= local) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return { index: starts.length - 1, age: cycle > 0 ? local : -1 };
  return { index: low - 1, age: local - (starts[low - 1] ?? 0) };
}

export function SkyEvents({ seed, width, height, time }: {
  seed: number; width: number; height: number; time: SharedValue<number>;
}): ReactElement {
  const { color } = useTheme();
  const schedule = useMemo(() => generateSkyEventSchedule(seed, starfield.scheduleCount), [seed]);
  const paths = useMemo(() => {
    const next = mulberry32(seed ^ 0x51f15e);
    const range = (min: number, max: number): number => min + next() * (max - min);
    return Array.from({ length: starfield.scheduleCount }, () => ({
      angle: range(...starfield.meteor.angle) * Math.PI / 180,
      length: range(...starfield.meteor.length), y: next() * height,
      satelliteY: next() * height, satelliteEndY: next() * height,
      satelliteDuration: range(...starfield.satellite.duration),
    }));
  }, [seed, height]);
  const meteor = useDerivedValue(() => {
    const event = scheduledEvent(time.get(), schedule.meteors);
    const path = paths[event.index];
    const progress = event.age / starfield.meteor.duration;
    const length = path?.length ?? starfield.meteor.length[0];
    const angle = path?.angle ?? 0;
    const x = -length + progress * (width + 2 * length);
    const y = (path?.y ?? 0) + (x - width / 2) * Math.tan(angle);
    return { head: vec(x, y), tail: vec(x - length * Math.cos(angle), y - length * Math.sin(angle)),
      alpha: event.age >= 0 && progress <= 1 ? 1 : 0 };
  });
  const head = useDerivedValue(() => meteor.get().head);
  const tail = useDerivedValue(() => meteor.get().tail);
  const meteorOpacity = useDerivedValue(() => meteor.get().alpha);
  const headX = useDerivedValue(() => head.get().x);
  const headY = useDerivedValue(() => head.get().y);
  const satellite = useDerivedValue(() => {
    const event = scheduledEvent(time.get(), schedule.satellites);
    const path = paths[event.index];
    const progress = event.age / (path?.satelliteDuration ?? starfield.satellite.duration[0]);
    return { x: progress * width,
      y: (path?.satelliteY ?? 0) + progress * ((path?.satelliteEndY ?? 0) - (path?.satelliteY ?? 0)),
      alpha: event.age >= 0 && progress <= 1 ? starfield.satellite.alpha : 0 };
  });
  const satelliteX = useDerivedValue(() => satellite.get().x);
  const satelliteY = useDerivedValue(() => satellite.get().y);
  const satelliteOpacity = useDerivedValue(() => satellite.get().alpha);
  return <>
    <Line p1={tail} p2={head} strokeWidth={starfield.meteor.strokeWidth} opacity={meteorOpacity}>
      <LinearGradient start={tail} end={head} colors={[transparentColor(color.star), color.star]} />
    </Line>
    <Circle cx={headX} cy={headY} r={starfield.meteor.headRadius} color={color.star} opacity={meteorOpacity} />
    <Circle cx={satelliteX} cy={satelliteY} r={starfield.satellite.radius}
      color={color.starfield} opacity={satelliteOpacity} />
  </>;
}
