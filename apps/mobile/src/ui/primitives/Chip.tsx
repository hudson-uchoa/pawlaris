import type { ReactElement } from 'react';

export type ChipProps = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function Chip(_props: ChipProps): ReactElement | null {
  return null;
}
