import type { ReactElement } from 'react';
import type { TextInputProps } from 'react-native';

export type TextFieldProps = Omit<TextInputProps, 'accessibilityLabel'> & {
  label: string;
  accessibilityLabel: string;
  error?: string;
  disabled?: boolean;
};

export function TextField(_props: TextFieldProps): ReactElement | null {
  return null;
}
