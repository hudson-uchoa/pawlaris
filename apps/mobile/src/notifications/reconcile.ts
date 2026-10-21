import type { Kv } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { ReplicaStore } from '../replica/store';
import type { NotificationsPort } from './port';

export interface ReconcileDependencies {
  clock: Clock;
  kv: Kv;
  store: ReplicaStore;
  me(): string;
  platform: Pick<NotificationsPort, 'getAllScheduledNotificationsAsync'
    | 'scheduleNotificationAsync' | 'cancelScheduledNotificationAsync'>;
}

export async function reconcile(_dependencies: ReconcileDependencies): Promise<void> {
  throw new Error('not implemented');
}
