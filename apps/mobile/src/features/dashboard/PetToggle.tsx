import type { Completion, Member, Pet } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export interface PetToggleProps {
  pet: Pet;
  completion: Completion | null;
  members: Readonly<Record<string, Member>>;
  timezone: string;
  active: boolean;
  disabled: boolean;
  testID: string;
  onPress(): void;
}

export function PetToggle(_props: PetToggleProps): ReactElement {
  throw new Error('not implemented');
}
