import type { ReminderItem } from '@pawlaris/shared';
import { strings } from '../i18n/strings';

export interface NotificationText {
  title: string;
  body: string;
}

export function reminderText(item: ReminderItem): NotificationText {
  switch (item.kind) {
    case 'reminder': return { title: item.taskTitle ?? '', body: (item.petNames ?? []).join(', ') };
    case 'health_due': return { title: item.healthTitle ?? '', body: strings.notifications.healthDueBody(item.petName ?? '') };
    case 'timer': return { title: strings.notifications.timerTitle, body: item.taskTitle ?? '' };
  }
}
