import type { ReactElement } from 'react';

export type PlaceholderScreenProps = { title: string; testID: string };

export function PlaceholderScreen(props: PlaceholderScreenProps): ReactElement {
  void props;
  throw new Error('Shell placeholder not implemented');
}
