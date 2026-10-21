import * as Notifications from 'expo-notifications';

type ExpoNotifications = typeof Notifications;

export type NotificationsPort = Pick<ExpoNotifications,
  | 'getAllScheduledNotificationsAsync'
  | 'scheduleNotificationAsync'
  | 'cancelScheduledNotificationAsync'
  | 'setNotificationChannelAsync'
  | 'setNotificationHandler'
  | 'addNotificationResponseReceivedListener'
  | 'getLastNotificationResponse'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'>;

export function createExpoNotifications(): NotificationsPort {
  return Notifications;
}
