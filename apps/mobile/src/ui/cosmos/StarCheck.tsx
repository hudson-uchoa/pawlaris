import type { ReactElement } from 'react';

export type StarCheckProps = {
  checked: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  active: boolean;
  disabled?: boolean;
  testID?: string;
};

export function StarCheck(props: StarCheckProps): ReactElement {
  void props;
  throw new Error('StarCheck is not implemented');
}
