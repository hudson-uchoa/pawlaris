import type { ReactElement } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme';
import { accessibility } from '../tokens/accessibility';
import { borderWidth } from '../tokens/elevation';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { typography } from '../tokens/type';
import { Text } from './Text';

export type TextFieldProps = Omit<TextInputProps, 'accessibilityLabel'> & {
  label: string;
  accessibilityLabel: string;
  error?: string;
  disabled?: boolean;
};

export function TextField({ label, error, disabled = false, editable, style, accessibilityState,
  onChangeText, ...props }: TextFieldProps): ReactElement {
  const { color } = useTheme();
  return <View style={{ gap: spacing.xs }}>
    <Text variant="label">{label}</Text>
    <TextInput {...props} editable={!disabled && editable !== false}
      accessibilityState={{ ...accessibilityState, disabled }}
      maxFontSizeMultiplier={accessibility.maxFontSizeMultiplier}
      onChangeText={disabled ? undefined : onChangeText} placeholderTextColor={color.textMuted}
      style={[typography.body, { minWidth: accessibility.minTouchTarget, minHeight: accessibility.minTouchTarget,
        borderWidth, borderRadius: radius.chip, borderColor: error ? color.danger : color.textMuted,
        backgroundColor: disabled ? color.surfaceSunken : color.surface, color: color.text,
        paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, style]} />
    {error !== undefined && <Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text>}
  </View>;
}
