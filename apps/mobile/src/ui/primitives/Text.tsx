import type { ReactElement } from 'react';
import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';
import { useTheme, type ColorToken } from '../theme';
import { accessibility } from '../tokens/accessibility';
import { typography } from '../tokens/type';

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
export type TextProps = Omit<NativeTextProps, 'maxFontSizeMultiplier'> & {
  variant?: TextVariant;
  color?: ColorToken;
};

export function Text({ variant = 'body', color = 'text', style, ...props }: TextProps): ReactElement {
  const theme = useTheme();
  return <NativeText {...props} maxFontSizeMultiplier={accessibility.maxFontSizeMultiplier}
    style={[typography[variant], { color: theme.color[color] }, style]} />;
}
