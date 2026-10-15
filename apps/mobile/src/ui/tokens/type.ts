import type { TextStyle } from 'react-native';

export const typography = {
  display: { fontFamily: 'Space Grotesk', fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontFamily: 'Space Grotesk', fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontFamily: 'Space Grotesk', fontSize: 18, lineHeight: 24, fontWeight: '500' },
  body: { fontFamily: 'Roboto', fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontFamily: 'Roboto', fontSize: 14, lineHeight: 18, fontWeight: '500' },
  caption: { fontFamily: 'Roboto', fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const satisfies Record<string, TextStyle>;
