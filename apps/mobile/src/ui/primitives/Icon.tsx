import type { LucideIcon } from 'lucide-react-native';
import type { ReactElement } from 'react';
import type { ColorToken } from '../theme';

export type IconProps = {
  glyph: LucideIcon;
  size?: 20 | 24;
  color?: ColorToken;
  accessibilityLabel?: string;
  testID?: string;
};

export function Icon(_props: IconProps): ReactElement | null {
  return null;
}
