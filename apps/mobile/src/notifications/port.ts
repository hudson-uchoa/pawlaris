import * as Notifications from 'expo-notifications';

type ExpoNotifications = typeof Notifications;

export type NotificationsPort = Pick<ExpoNotifications,
  | 'registerTaskAsync'
  | 'getAllScheduledNotificationsAsync'
  | 'scheduleNotificationAsync'
  | 'cancelScheduledNotificationAsync'
  | 'setNotificationChannelAsync'
  | 'setNotificationHandler'
  | 'addNotificationResponseReceivedListener'
  | 'getLastNotificationResponse'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'
  | 'getExpoPushTokenAsync'>;

export function createExpoNotifications(): NotificationsPort {
  return Notifications;
}
