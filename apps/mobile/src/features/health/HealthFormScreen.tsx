import type { ReactElement } from 'react';
import type { HealthScreenProps } from './types';

export type HealthFormScreenProps = HealthScreenProps & {
  petId: string;
  eventId?: string;
};

export function HealthFormScreen(_props: HealthFormScreenProps): ReactElement {
  throw new Error('not implemented');
}
