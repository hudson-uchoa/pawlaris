import type { ReactElement } from 'react';

export type SegmentOption = { value: string; label: string; disabled?: boolean };
export type SegmentedControlProps = {
  options: readonly SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
  disabled?: boolean;
};

export function SegmentedControl(_props: SegmentedControlProps): ReactElement | null {
  return null;
}
