import { defineTask, type TaskManagerTaskBody } from 'expo-task-manager';
import type { Api } from '../api/client';
import { Kv, serverKey, type Server } from '../db/kv';
import { expoSqliteDriver, type SqlDriver } from '../db/driver';
import { openDatabase } from '../db/open';
import { ReplicaRepo } from '../db/replicaRepo';
import { createExpoNotifications, type NotificationsPort } from './port';

export const PUSH_TASK = 'pawlaris.push';

export interface PushMessageData {
  type?: string;
  silent?: boolean | string;
  task_id?: string;
  occurrence_key?: string;
  pet_id?: string | null;
  author_id?: string;
  actor_id?: string;
}

export interface PushTaskDependencies {
  driver: SqlDriver;
  notifications: Pick<NotificationsPort, 'cancelScheduledNotificationAsync'>;
}

export async function handlePushTask(
  dependencies: PushTaskDependencies,
  body: TaskManagerTaskBody<PushMessageData>,
): Promise<void> {
  if (body.error !== null || body.data === undefined) return;
  const data = body.data;
  const user = new Kv(dependencies.driver).get('session_user');
  if (user !== null) {
    const current = JSON.parse(user) as { id?: unknown };
    if (data.author_id === current.id || data.actor_id === current.id) return;
  }
  if (data.type !== 'completion' || data.task_id === undefined
    || data.occurrence_key === undefined) return;
  const task = new ReplicaRepo(dependencies.driver).get('task_templates', data.task_id)?.row;
  if (task?.completion_mode !== 'together') return;
  const id = `rem:${data.task_id}:${data.occurrence_key}`;
  await dependencies.notifications.cancelScheduledNotificationAsync(id);
  const kv = new Kv(dependencies.driver);
  const stored = kv.get('suppressed_reminders');
  let suppressed: string[] = [];
  if (stored !== null) {
    try { suppressed = JSON.parse(stored) as string[]; }
    catch { suppressed = []; }
  }
  if (!suppressed.includes(id)) kv.set('suppressed_reminders', JSON.stringify([...suppressed, id]));
}

export interface PushRegistrationDependencies {
  notifications: Pick<NotificationsPort, 'getExpoPushTokenAsync'>;
  api: Pick<Api, 'request'>;
  kv: Kv;
  activeServer(): Server;
}

export async function registerPushToken({
  notifications, api, kv, activeServer,
}: PushRegistrationDependencies): Promise<void> {
  let token: string;
  try {
    token = (await notifications.getExpoPushTokenAsync()).data;
  } catch {
    return;
  }
  const server = activeServer();
  if (kv.get(serverKey('push_token_sent', server)) === token) return;
  try {
    const result = await api.request('PUT', '/me/push-token', { token });
    if ('ok' in result && result.ok) kv.set(serverKey('push_token_sent', server), token);
  } catch {
    // Push registration is best effort; the next foreground retries it.
  }
}

defineTask<PushMessageData>(PUSH_TASK, async (body) => {
  const driver = expoSqliteDriver();
  openDatabase(driver);
  await handlePushTask({ driver, notifications: createExpoNotifications() }, body);
});

void createExpoNotifications().registerTaskAsync(PUSH_TASK).catch(() => {
  // Native notification support may be unavailable during local development.
});
