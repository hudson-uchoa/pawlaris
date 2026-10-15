import type { ReactElement } from 'react';
import { LoaderCircle } from 'lucide-react-native';
import { useTheme } from '../theme';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { PressableScale } from './PressableScale';
import { Icon } from './Icon';
import { Text } from './Text';

export type ButtonProps = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
  testID?: string;
};

export function Button({ label, accessibilityLabel, onPress, disabled = false, loading = false, active = true, testID }: ButtonProps): ReactElement {
  const { color } = useTheme();
  const muted = disabled && !loading;
  return <PressableScale accessibilityLabel={accessibilityLabel} onPress={onPress} disabled={disabled || loading} active={active}
    accessibilityState={{ disabled: disabled || loading, busy: loading }} testID={testID}
    style={{ backgroundColor: muted ? color.surfaceSunken : color.accent, borderRadius: radius.chip,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', gap: spacing.xs,
      alignItems: 'center', justifyContent: 'center' }}>
    {loading && <Icon glyph={LoaderCircle} color="onAccent" />}
    <Text variant="label" color={muted ? 'textMuted' : 'onAccent'}>{label}</Text>
  </PressableScale>;
}
