import type { ReactElement } from 'react';
import type { IllustrationProps } from './types';

export function EmptyPets(props: IllustrationProps): ReactElement {
  void props;
  throw new Error('EmptyPets is not implemented');
}
