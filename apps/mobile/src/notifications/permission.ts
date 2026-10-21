import type { Kv } from '../db/kv';
import type { NotificationsPort } from './port';

export type RationaleTrigger = 'task_created' | 'sync';

export interface NotificationPermission {
  shouldShowRationale(trigger: RationaleTrigger, hasTimedTemplate: boolean): Promise<boolean>;
  decline(): void;
  request(): Promise<boolean>;
}

export interface PermissionDependencies {
  kv: Kv;
  platform: Pick<NotificationsPort, 'getPermissionsAsync' | 'requestPermissionsAsync'>;
}

export function createNotificationPermission({ kv, platform }: PermissionDependencies): NotificationPermission {
  const seenKey = 'notification_rationale_seen';
  return {
    async shouldShowRationale(trigger, hasTimedTemplate) {
      if (kv.get(seenKey) === '1' || (trigger === 'sync' && !hasTimedTemplate)) return false;
      if ((await platform.getPermissionsAsync()).granted || kv.get(seenKey) === '1') return false;
      kv.set(seenKey, '1');
      return true;
    },
    decline() { kv.set(seenKey, '1'); },
    async request() {
      kv.set(seenKey, '1');
      return (await platform.requestPermissionsAsync()).granted;
    },
  };
}
