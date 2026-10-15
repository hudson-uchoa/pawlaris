import type { dark, light } from './tokens/color';

export type ThemeScheme = 'light' | 'dark';
export type ThemeColors = { readonly [K in keyof typeof light]: (typeof light)[K] | (typeof dark)[K] };
export type ColorToken = keyof ThemeColors;
export type Theme = { scheme: ThemeScheme; color: ThemeColors };

export function useTheme(): Theme {
  throw new Error('useTheme not implemented');
}
