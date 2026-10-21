import type { ReactElement } from 'react';
import type { WalkScreenServices } from './types';

export interface WalkDetailScreenProps {
  walkId: string;
  services: WalkScreenServices;
  active: boolean;
  onDiscarded(): void;
}

export function WalkDetailScreen(_props: WalkDetailScreenProps): ReactElement {
  throw new Error('not implemented');
}
