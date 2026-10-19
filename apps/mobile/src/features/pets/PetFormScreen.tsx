import type { ReactElement } from 'react';
import type { PetScreenProps } from './types';

export type PetFormScreenProps = PetScreenProps & {
  petId?: string;
  onClose(): void;
  onAvatar(): void;
};

export function PetFormScreen(_props: PetFormScreenProps): ReactElement {
  throw new Error('not implemented');
}
