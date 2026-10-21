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

export function createNotificationPermission(_dependencies: PermissionDependencies): NotificationPermission {
  return {
    async shouldShowRationale(_trigger, _hasTimedTemplate) {
      throw new Error('not implemented');
    },
    decline() { throw new Error('not implemented'); },
    async request() { throw new Error('not implemented'); },
  };
}
