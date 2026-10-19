import type { ReactElement } from 'react';
import type { FamilyServices } from '../family/types';

export interface PasswordScreenProps {
  services: FamilyServices;
  active: boolean;
  onClose(): void;
}

export function PasswordScreen(_props: PasswordScreenProps): ReactElement {
  throw new Error('not implemented');
}
