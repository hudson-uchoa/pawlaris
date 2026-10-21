import type { NotificationsPort } from './port';

export async function createNotificationChannels(
  _platform: Pick<NotificationsPort, 'setNotificationChannelAsync'>,
): Promise<void> {
  throw new Error('not implemented');
}
