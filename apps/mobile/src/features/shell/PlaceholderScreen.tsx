import type { ReactElement } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { shell } from './tokens';

export type PlaceholderScreenProps = { title: string; testID: string; loading?: boolean; onLayout?: () => void };

export function PlaceholderScreen({ title, testID, loading = false, onLayout }: PlaceholderScreenProps): ReactElement {
  const { color } = useTheme();
  const active = useIsFocused();
  const { width } = useWindowDimensions();
  return <ScrollView testID={testID} onLayout={onLayout} style={{ flex: 1, backgroundColor: color.bg }}>
    <View key={loading ? 'loading' : 'ready'} onLayout={onLayout} style={{ padding: spacing.md, gap: spacing.md }}>
      <Text variant="title" accessibilityRole="header">{title}</Text>
      {loading && Array.from({ length: shell.skeletonCount }, (_, index) => <Skeleton key={index}
        width={Math.max(0, width - 2 * spacing.md)} height={shell.skeletonHeight} active={active} />)}
    </View>
  </ScrollView>;
}
