import type { NotificationsPort } from './port';
import { AndroidImportance } from 'expo-notifications';
import { strings } from '../i18n/strings';

export async function createNotificationChannels(
  platform: Pick<NotificationsPort, 'setNotificationChannelAsync'>,
): Promise<void> {
  const names = strings.notifications.channels;
  await platform.setNotificationChannelAsync('reminders-critical', {
    name: names.critical, importance: AndroidImportance.HIGH,
    sound: 'default', enableVibrate: true,
  });
  await platform.setNotificationChannelAsync('reminders-routine', {
    name: names.routine, importance: AndroidImportance.DEFAULT,
  });
  await platform.setNotificationChannelAsync('timers', {
    name: names.timers, importance: AndroidImportance.HIGH, sound: 'default',
  });
  await platform.setNotificationChannelAsync('family-activity', {
    name: names.familyActivity, importance: AndroidImportance.DEFAULT,
  });
}
