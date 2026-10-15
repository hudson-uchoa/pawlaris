import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type SwitchProps = {
  label: string;
  accessibilityLabel: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  active?: boolean;
  testID?: string;
};

export function Switch({ label, accessibilityLabel, value, onValueChange, disabled = false, active = true, testID }: SwitchProps): ReactElement {
  const { color } = useTheme();
  return <PressableScale accessibilityLabel={accessibilityLabel} accessibilityRole="switch" active={active}
    accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onValueChange(!value)}
    testID={testID} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.xs }}>
    <Text style={{ flex: 1 }} color={disabled ? 'textMuted' : 'text'}>{label}</Text>
    <View importantForAccessibility="no-hide-descendants" style={{ width: spacing.xxl, height: spacing.lg,
      borderRadius: radius.avatar, padding: spacing.xxs, backgroundColor: value ? color.accent : color.textMuted }}>
      <View style={{ width: spacing.md, height: spacing.md, borderRadius: radius.avatar,
        backgroundColor: value ? color.onAccent : color.surface,
        transform: [{ translateX: value ? spacing.lg : 0 }] }} />
    </View>
  </PressableScale>;
}
