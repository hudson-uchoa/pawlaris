import { useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import type { NotificationPermission } from '../../notifications/permission';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';

export interface NotificationsScreenProps {
  permission: NotificationPermission;
  active: boolean;
  onClose(): void;
}

export function NotificationsScreen({ permission, active, onClose }: NotificationsScreenProps): ReactElement {
  const { color } = useTheme();
  const requesting = useRef(false);
  const [failed, setFailed] = useState(false);
  return <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg,
    gap: spacing.md, backgroundColor: color.bg }}>
    <Text>{strings.notifications.rationale}</Text>
    {failed && <Text accessibilityRole="alert">{strings.notifications.permissionError}</Text>}
    <Button label={strings.notifications.activate} accessibilityLabel={strings.notifications.activate} active={active} onPress={() => {
      if (!active || requesting.current) return;
      requesting.current = true;
      setFailed(false);
      void permission.request().then(onClose).catch(() => { setFailed(true); })
        .finally(() => { requesting.current = false; });
    }} />
    <Button label={strings.notifications.later} accessibilityLabel={strings.notifications.later} active={active} onPress={() => {
      if (!active || requesting.current) return;
      permission.decline(); onClose();
    }} />
  </View>;
}
