import type { ReactElement } from 'react';
import type { HealthScreenProps } from './types';

export type HealthDetailScreenProps = HealthScreenProps & {
  eventId: string;
};

export function HealthDetailScreen(_props: HealthDetailScreenProps): ReactElement {
  throw new Error('not implemented');
}
