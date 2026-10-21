import type { ReactElement } from 'react';
import type { SharedValue } from 'react-native-reanimated';

export interface SupernovaProps {
  time: SharedValue<number>;
  x: number;
  y: number;
  seed: number;
}

// P5-9 red scaffold: draw nodes will share ShootingStars' canvas and time.
export function Supernova(_props: SupernovaProps): ReactElement | null {
  return null;
}
