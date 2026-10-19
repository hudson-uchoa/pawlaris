import type { ReactElement } from 'react';
import type { PetScreenProps } from './types';

export type PetProfileScreenProps = PetScreenProps & {
  petId: string;
  onEdit(): void;
  onAddWeight(): void;
  onWalks(): void;
};

export const PetProfileScreen: (props: PetProfileScreenProps) => ReactElement = () => {
  throw new Error('not implemented');
};
