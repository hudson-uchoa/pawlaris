import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { spacing } from '../tokens/spacing';
import { Button } from './Button';
import { Text } from './Text';

export type EmptyStateProps = {
  title: string;
  description?: string;
  illustration?: ReactNode;
  active?: boolean;
  action?: {
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  };
};

export function EmptyState({ title, description, illustration, action, active = true }: EmptyStateProps): ReactElement {
  return <View style={{ padding: spacing.lg, gap: spacing.md, alignItems: 'center' }}>
    {illustration}
    <Text variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>{title}</Text>
    {description !== undefined && <Text color="textMuted" style={{ textAlign: 'center' }}>{description}</Text>}
    {action !== undefined && <Button {...action} active={active} />}
  </View>;
}
