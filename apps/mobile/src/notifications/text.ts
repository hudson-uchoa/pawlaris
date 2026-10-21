import type { ReminderItem } from '@pawlaris/shared';

export interface NotificationText {
  title: string;
  body: string;
}

export function reminderText(_item: ReminderItem): NotificationText {
  throw new Error('not implemented');
}
