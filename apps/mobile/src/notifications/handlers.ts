import type { Notification, NotificationBehavior, NotificationResponse } from 'expo-notifications';
import type { NotificationText } from './text';
import type { NotificationsPort } from './port';
import { isLocalNotification } from './reconcile';

export interface NotificationNavigation {
  dashboard(date?: string): void;
  walks(): void;
}

export interface HandlerDependencies {
  platform: Pick<NotificationsPort, 'setNotificationHandler'
    | 'addNotificationResponseReceivedListener'>
    & Partial<Pick<NotificationsPort, 'getLastNotificationResponse'>>;
  showToast(text: NotificationText): void;
  navigation: NotificationNavigation;
}

export async function foregroundNotification(
  notification: Notification,
  showToast: HandlerDependencies['showToast'],
): Promise<NotificationBehavior> {
  const local = isLocalNotification(notification.request.identifier);
  if (!local) {
    const { title, body } = notification.request.content;
    showToast({ title: title ?? '', body: body ?? '' });
  }
  return { shouldShowBanner: local, shouldShowList: local,
    shouldPlaySound: local, shouldSetBadge: false };
}

export function handleNotificationResponse(
  response: NotificationResponse,
  navigation: NotificationNavigation,
): void {
  const data = response.notification.request.content.data;
  if (data?.type === 'walk_started') { navigation.walks(); return; }
  const occurrence = data?.occurrenceKey ?? data?.occurrence_key;
  const date = typeof data?.date === 'string' ? data.date
    : typeof occurrence === 'string' ? occurrence.slice(0, 10) : undefined;
  navigation.dashboard(date);
}

export function installNotificationHandlers({ platform, showToast, navigation }: HandlerDependencies): () => void {
  platform.setNotificationHandler({ handleNotification: (notification) => foregroundNotification(notification, showToast) });
  const listener = platform.addNotificationResponseReceivedListener((response) => {
    handleNotificationResponse(response, navigation);
  });
  const last = platform.getLastNotificationResponse?.();
  if (last != null) handleNotificationResponse(last, navigation);
  return () => { listener.remove(); platform.setNotificationHandler(null); };
}
