import { useColorScheme } from 'react-native';
import { dark, light } from './tokens/color';

export type ThemeScheme = 'light' | 'dark';
export type ThemeColors = { readonly [K in keyof typeof light]: (typeof light)[K] | (typeof dark)[K] };
export type ColorToken = keyof ThemeColors;
export type Theme = { scheme: ThemeScheme; color: ThemeColors };

const themes = {
  light: { scheme: 'light', color: light },
  dark: { scheme: 'dark', color: dark },
} as const satisfies Record<ThemeScheme, Theme>;

export function useTheme(): Theme {
  // Match Android Appearance: explicit night mode is dark, otherwise light.
  return useColorScheme() === 'dark' ? themes.dark : themes.light;
}
