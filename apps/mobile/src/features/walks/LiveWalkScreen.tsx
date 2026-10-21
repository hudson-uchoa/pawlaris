import type { ReactElement } from 'react';
import type { LiveWalkServices } from '../../walks/live';

export interface LiveWalkScreenProps {
  services: LiveWalkServices;
  active: boolean;
  onFinished(walkId: string): void;
  onDiscarded(): void;
  onLocationSettings(): void;
}

export function LiveWalkScreen(props: LiveWalkScreenProps): ReactElement | null {
  void props;
  return null;
}
