import type { Kv } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { ReplicaStore } from '../replica/store';
import type { NotificationsPort } from './port';
import { localDate, planReminders } from '@pawlaris/shared';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { reminderText } from './text';

export function isLocalNotification(id: string): boolean {
  return ['rem:', 'due:', 'tmr:'].some((prefix) => id.startsWith(prefix));
}

export interface ReconcileDependencies {
  clock: Clock;
  kv: Kv;
  store: ReplicaStore;
  me(): string;
  platform: Pick<NotificationsPort, 'getAllScheduledNotificationsAsync'
    | 'scheduleNotificationAsync' | 'cancelScheduledNotificationAsync'>;
}

export async function reconcile({ clock, kv, store, me, platform }: ReconcileDependencies): Promise<void> {
  const state = store.getState();
  const tz = state.family?.timezone ?? 'UTC';
  const suppressed: string[] = JSON.parse(kv.get('suppressed_reminders') ?? '[]') as string[];
  const desired = planReminders({ now: clock.now(), tz, me: me(),
    templates: Object.values(state.taskTemplates), completions: Object.values(state.completions),
    pets: Object.values(state.pets), healthEvents: Object.values(state.healthEvents),
    timers: Object.values(state.timers), suppressedIds: new Set(suppressed),
  });
  const wanted = new Map(desired.map((item) => [item.id, item]));
  const existing = new Map((await platform.getAllScheduledNotificationsAsync())
    .filter((item) => isLocalNotification(item.identifier)).map((item) => [item.identifier, item]));
  for (const [id, request] of existing) {
    if (!wanted.has(id) || wanted.get(id)?.fp !== request.content.data?.fp) {
      await platform.cancelScheduledNotificationAsync(id);
      existing.delete(id);
    }
  }
  for (const item of desired) {
    if (existing.has(item.id)) continue;
    const event = item.healthEventId === undefined ? undefined : state.healthEvents[item.healthEventId];
    await platform.scheduleNotificationAsync({
      identifier: item.id,
      content: { ...reminderText(item), sound: 'default', data: {
        kind: item.kind, fp: item.fp,
        date: item.occurrenceKey?.slice(0, 10) ?? localDate(item.fireAt, tz),
        ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
        ...(item.occurrenceKey === undefined ? {} : { occurrenceKey: item.occurrenceKey }),
        ...(event === undefined ? {} : { petId: event.pet_id }),
      } },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: item.fireAt, channelId: item.channel },
    });
  }
}
