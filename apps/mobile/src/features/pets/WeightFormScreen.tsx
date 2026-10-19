import type { ReactElement } from 'react';
import type { PetScreenProps } from './types';

export type WeightFormScreenProps = PetScreenProps & {
  petId: string;
  onClose(): void;
};

export const WeightFormScreen: (props: WeightFormScreenProps) => ReactElement = () => {
  throw new Error('not implemented');
};
