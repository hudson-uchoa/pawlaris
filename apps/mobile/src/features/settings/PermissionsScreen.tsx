import { useContext, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { strings } from '../../i18n/strings';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import type { PermissionsScreenProps } from './types';

export function PermissionsScreen(_props: PermissionsScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const permissions = ['notifications', 'location', 'backgroundLocation', 'battery', 'camera'] as const;
  return <ScrollView testID="permissions-list" style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    <Text variant="title" accessibilityRole="header">{strings.settings.permissions}</Text>
    {permissions.map((permission) => <View key={permission} testID={`permission-${permission}`}>
      <Text>{strings.diagnostics[permission]}</Text>
    </View>)}
  </ScrollView>;
}
