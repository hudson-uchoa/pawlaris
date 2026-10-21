import { createContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { duration } from '../motion/tokens';
import { shootingStars } from '../tokens/cosmos';
import type { SkyStar } from './sky';

// The provider belongs inside Canvas: Skia has a separate React root.
export const CelebrationContext = createContext<{
  time: SharedValue<number>;
  active: boolean;
  seed: number;
  origin: SkyStar | undefined;
  scroll: SharedValue<number>;
} | null>(null);

export function celebrationBrightness(time: number): number {
  'worklet';
  // A negative time is the reduced-motion hold, ended by one delayed cut.
  return time < 0 ? 1 : Math.max(0, Math.min(1,
    time / duration.quick, (shootingStars.duration - time) / duration.quick));
}
