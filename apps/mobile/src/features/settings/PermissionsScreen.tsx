import { useContext, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { strings } from '../../i18n/strings';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { Button } from '../../ui/primitives/Button';
import type { PermissionsScreenProps } from './types';
import { WalkPermissionRows } from '../walks/WalkPermissionRows';

export function PermissionsScreen({ active, onNotifications, walkPermissions, onLocation }: PermissionsScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const permissions = walkPermissions === undefined
    ? ['notifications', 'location', 'backgroundLocation', 'battery', 'camera'] as const
    : ['notifications'] as const;
  return <ScrollView testID="permissions-list" style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    {permissions.map((permission) => <View key={permission} testID={`permission-${permission}`}>
      {permission === 'notifications'
        ? <Button label={strings.diagnostics.notifications} accessibilityLabel={strings.diagnostics.notifications}
          active={active} onPress={() => { onNotifications?.(); }} />
        : <Text>{strings.diagnostics[permission]}</Text>}
    </View>)}
    {walkPermissions !== undefined && <WalkPermissionRows permissions={walkPermissions} active={active}
      onLocation={() => { onLocation?.(); }} />}
  </ScrollView>;
}
