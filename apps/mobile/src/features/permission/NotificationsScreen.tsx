import type { ReactElement } from 'react';
import type { NotificationPermission } from '../../notifications/permission';

export interface NotificationsScreenProps {
  permission: NotificationPermission;
  active: boolean;
  onClose(): void;
}

export function NotificationsScreen(_props: NotificationsScreenProps): ReactElement | null {
  return null;
}
