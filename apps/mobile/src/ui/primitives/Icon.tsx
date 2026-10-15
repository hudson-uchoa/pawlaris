import type { LucideIcon } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { useTheme, type ColorToken } from '../theme';
import { icon } from '../tokens/icon';

export type IconProps = {
  glyph: LucideIcon;
  size?: 20 | 24;
  color?: ColorToken;
  accessibilityLabel?: string;
  testID?: string;
};

export function Icon({ glyph: Glyph, size = icon.small, color = 'text', accessibilityLabel, testID }: IconProps): ReactElement {
  const theme = useTheme();
  const meaningful = accessibilityLabel !== undefined;
  return <Glyph size={size} color={theme.color[color]} strokeWidth={icon.strokeWidth}
    {...(testID === undefined ? {} : { testID })}
    {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })} accessibilityRole="image"
    accessible={meaningful} aria-hidden={!meaningful}
    importantForAccessibility={meaningful ? 'yes' : 'no-hide-descendants'} />;
}
