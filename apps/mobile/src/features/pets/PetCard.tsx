import type { Pet } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export type PetCardProps = {
  pet: Pet;
  now: number;
  timezone: string;
  active: boolean;
  onPress(): void;
};

export function PetCard(_props: PetCardProps): ReactElement {
  throw new Error('not implemented');
}
