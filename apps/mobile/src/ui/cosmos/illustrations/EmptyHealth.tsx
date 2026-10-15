import type { ReactElement } from 'react';
import type { IllustrationProps } from './types';

export function EmptyHealth(props: IllustrationProps): ReactElement {
  void props;
  throw new Error('EmptyHealth is not implemented');
}
