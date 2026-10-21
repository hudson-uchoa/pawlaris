import type { ReactElement } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { useApp } from '../../src/appContext';
import { NotificationsScreen } from '../../src/features/permission/NotificationsScreen';

export default function Notifications(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  return <NotificationsScreen permission={app.notificationPermission} active={active}
    onClose={() => { router.back(); }} />;
}
