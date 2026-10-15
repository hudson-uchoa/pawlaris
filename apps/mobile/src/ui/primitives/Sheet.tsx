import type { ReactElement, ReactNode } from 'react';

export type SheetProps = {
  visible: boolean;
  accessibilityLabel: string;
  dismissLabel: string;
  onDismiss: () => void;
  children: ReactNode;
  testID?: string;
};

export function Sheet(_props: SheetProps): ReactElement | null {
  return null;
}
