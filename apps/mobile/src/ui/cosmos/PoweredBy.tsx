import type { ReactElement } from 'react';

export type PoweredByProps = {
  active: boolean;
  href?: string;
  testID?: string;
};

export function PoweredBy(props: PoweredByProps): ReactElement {
  void props;
  throw new Error('PoweredBy is not implemented');
}
