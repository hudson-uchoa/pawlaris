import type { ReactElement } from 'react';
import type { LocationState } from '../../walks/permissions';
import type { WalkScreenServices } from './types';

export interface WalksScreenProps {
  services: WalkScreenServices;
  active: boolean;
  locationState: LocationState;
  onStart(petId: string): void;
  onResume(): void;
  onOpenWalk(walkId: string): void;
  onRequestLocation(): void;
  onOpenSettings(): void;
}

export function WalksScreen(_props: WalksScreenProps): ReactElement {
  throw new Error('not implemented');
}
