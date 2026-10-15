import type { ReactElement } from 'react';

export type AvatarProps = {
  petId: string;
  species: 'cat' | 'dog';
  accessibilityLabel: string;
  uri?: string | null;
  size?: number;
  testID?: string;
};

export function Avatar(_props: AvatarProps): ReactElement | null {
  return null;
}
