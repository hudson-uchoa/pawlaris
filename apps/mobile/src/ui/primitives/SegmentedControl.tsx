import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type SegmentOption = { value: string; label: string; disabled?: boolean };
export type SegmentedControlProps = {
  options: readonly SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  active?: boolean;
};

export function SegmentedControl({ options, value, onValueChange, accessibilityLabel, disabled = false, active = true }: SegmentedControlProps): ReactElement {
  const { color } = useTheme();
  return <View accessible accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs, borderRadius: radius.chip, backgroundColor: color.surfaceSunken }}>
    {options.map((option) => {
      const checked = option.value === value;
      const unavailable = disabled || option.disabled === true;
      return <PressableScale key={option.value} accessibilityLabel={option.label} accessibilityRole="radio" active={active}
        accessibilityState={{ checked, disabled: unavailable }} disabled={unavailable}
        onPress={() => onValueChange(option.value)}
        style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.sm,
          borderRadius: radius.chip, backgroundColor: checked ? color.accentSoft : color.surfaceSunken }}>
        <Text variant="label" color={unavailable ? 'textMuted' : checked ? 'accent' : 'text'}>{option.label}</Text>
      </PressableScale>;
    })}
  </View>;
}
