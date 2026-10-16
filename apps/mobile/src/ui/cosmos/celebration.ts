import { createContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { duration } from '../motion/tokens';
import { shootingStars } from '../tokens/cosmos';

// The provider belongs inside Canvas: Skia has a separate React root.
export const CelebrationContext = createContext<{
  time: SharedValue<number>;
  active: boolean;
} | null>(null);

export function celebrationBrightness(time: number): number {
  'worklet';
  // A negative time is the reduced-motion hold, ended by one delayed cut.
  return time < 0 ? 1 : Math.max(0, Math.min(1,
    time / duration.quick, (shootingStars.duration - time) / duration.quick));
}
