import type { RoutePoint } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export interface WalkMapProps {
  points: readonly RoutePoint[];
  mode: 'live' | 'detail';
  active: boolean;
}

export function WalkMap(_props: WalkMapProps): ReactElement {
  throw new Error('not implemented');
}
