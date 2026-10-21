type ExpoNotifications = typeof import('expo-notifications');

export type NotificationsPort = Pick<ExpoNotifications,
  | 'getAllScheduledNotificationsAsync'
  | 'scheduleNotificationAsync'
  | 'cancelScheduledNotificationAsync'
  | 'setNotificationChannelAsync'
  | 'setNotificationHandler'
  | 'addNotificationResponseReceivedListener'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'>;

export function createExpoNotifications(): NotificationsPort {
  throw new Error('not implemented');
}
