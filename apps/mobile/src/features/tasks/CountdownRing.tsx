import type { Timer } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import type { Clock } from '../../platform/clock';

export interface CountdownRingProps {
  timer: Pick<Timer, 'started_at' | 'ends_at'>;
  clock: Clock;
  active: boolean;
  testID?: string;
}

export function CountdownRing(_props: CountdownRingProps): ReactElement | null {
  return null;
}
