import type { ReactElement, ReactNode } from 'react';
import type { ScrollViewProps } from 'react-native';

export type KeyboardAwareFormProps = Omit<ScrollViewProps, 'children' | 'keyboardShouldPersistTaps'> & {
  children: ReactNode;
  keyboardVerticalOffset?: number;
};

export function KeyboardAwareForm({ children }: KeyboardAwareFormProps): ReactElement {
  // Red-step stub: preserve children until the shared keyboard layout exists.
  return <>{children}</>;
}
