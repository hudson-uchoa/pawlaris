import type { Notification, NotificationBehavior, NotificationResponse } from 'expo-notifications';
import type { NotificationText } from './text';
import type { NotificationsPort } from './port';

export interface NotificationNavigation {
  dashboard(date?: string): void;
  walks(): void;
}

export interface HandlerDependencies {
  platform: Pick<NotificationsPort, 'setNotificationHandler'
    | 'addNotificationResponseReceivedListener'>;
  showToast(text: NotificationText): void;
  navigation: NotificationNavigation;
}

export async function foregroundNotification(
  _notification: Notification,
  _showToast: HandlerDependencies['showToast'],
): Promise<NotificationBehavior> {
  throw new Error('not implemented');
}

export function handleNotificationResponse(
  _response: NotificationResponse,
  _navigation: NotificationNavigation,
): void {
  throw new Error('not implemented');
}

export function installNotificationHandlers(_dependencies: HandlerDependencies): () => void {
  throw new Error('not implemented');
}
