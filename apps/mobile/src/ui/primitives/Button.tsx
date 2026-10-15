import type { ReactElement } from 'react';

export type ButtonProps = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
};

export function Button(_props: ButtonProps): ReactElement | null {
  return null;
}
