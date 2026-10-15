import type { ReactElement } from 'react';

export type SwitchProps = {
  label: string;
  accessibilityLabel: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
};

export function Switch(_props: SwitchProps): ReactElement | null {
  return null;
}
