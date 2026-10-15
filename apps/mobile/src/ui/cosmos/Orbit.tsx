import type { ReactElement, ReactNode } from 'react';

export type OrbitProps = {
  petId: string;
  size: number;
  active: boolean;
  children?: ReactNode;
  satellite?: boolean;
  testID?: string;
};

export function Orbit(props: OrbitProps): ReactElement {
  void props;
  throw new Error('Orbit is not implemented');
}
