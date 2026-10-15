import type { ReactElement, ReactNode } from 'react';

export type EmptyStateProps = {
  title: string;
  description?: string;
  illustration?: ReactNode;
  action?: {
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  };
};

export function EmptyState(_props: EmptyStateProps): ReactElement | null {
  return null;
}
