import type { ReactElement, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { borderWidth, elevation } from '../tokens/elevation';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { PressableScale } from './PressableScale';

export type CardProps = {
  children: ReactNode;
  accessibilityLabel: string;
  onPress?: () => void;
  disabled?: boolean;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Card({ children, accessibilityLabel, onPress, disabled = false, active = true, style, testID }: CardProps): ReactElement {
  const { color } = useTheme();
  const cardStyle: StyleProp<ViewStyle> = [{
    backgroundColor: color.surface, borderColor: color.border, borderWidth,
    borderRadius: radius.card, elevation: elevation.card, padding: spacing.md,
  }, style];
  if (onPress !== undefined) {
    return <PressableScale accessibilityLabel={accessibilityLabel} onPress={onPress}
      disabled={disabled} active={active} style={cardStyle} testID={testID}>{children}</PressableScale>;
  }
  return <View style={cardStyle} accessibilityLabel={accessibilityLabel} testID={testID}>{children}</View>;
}
