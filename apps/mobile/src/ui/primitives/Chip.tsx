import type { ReactElement } from 'react';
import { useTheme } from '../theme';
import { borderWidth } from '../tokens/elevation';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ChipProps = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  active?: boolean;
  testID?: string;
};

export function Chip({ label, accessibilityLabel, onPress, selected = false, disabled = false, active = true, testID }: ChipProps): ReactElement {
  const { color } = useTheme();
  return <PressableScale accessibilityLabel={accessibilityLabel} onPress={onPress} disabled={disabled} active={active}
    accessibilityState={{ selected, disabled }} testID={testID}
    style={{ borderWidth, borderRadius: radius.chip, borderColor: selected ? color.accent : color.textMuted,
      backgroundColor: disabled ? color.surfaceSunken : selected ? color.accentSoft : color.surface,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, justifyContent: 'center', alignItems: 'center' }}>
    <Text variant="label" color={disabled ? 'textMuted' : selected ? 'accent' : 'text'}>{label}</Text>
  </PressableScale>;
}
