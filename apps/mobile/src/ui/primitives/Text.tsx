import type { ReactElement } from 'react';
import type { TextProps as NativeTextProps } from 'react-native';
import type { ColorToken } from '../theme';

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
export type TextProps = Omit<NativeTextProps, 'maxFontSizeMultiplier'> & {
  variant?: TextVariant;
  color?: ColorToken;
};

export function Text(_props: TextProps): ReactElement | null {
  return null;
}
