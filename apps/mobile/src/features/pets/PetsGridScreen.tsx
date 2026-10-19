import type { ReactElement } from 'react';
import type { PetScreenProps } from './types';

export type PetsGridScreenProps = PetScreenProps & {
  onAdd(): void;
  onOpenPet(id: string): void;
};

export function PetsGridScreen(_props: PetsGridScreenProps): ReactElement {
  throw new Error('not implemented');
}
