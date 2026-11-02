import type { NotificationTaskPayload } from 'expo-notifications';
import type { TaskManagerTaskBody } from 'expo-task-manager';
import { Kv, serverKey } from '../../db/kv';
import { ReplicaRepo } from '../../db/replicaRepo';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { handlePushTask, registerPushToken } from '../backgroundTask';
import { notificationStorage } from './support';

function pushBody(data: NotificationTaskPayload): TaskManagerTaskBody<NotificationTaskPayload> {
  return { data, error: null,
    executionInfo: { eventId: 'event', taskName: 'pawlaris.push' } };
}

test('P5-8 token registration sends only changed tokens and once to each server', async () => {
  const storage = await notificationStorage();
  let server: 'primary' | 'reserve' = 'primary';
  const requests: { server: string; token: string }[] = [];
  const api = { request: async (_method: 'PUT', _path: string, body?: unknown) => {
    const token = (body as { token: string }).token;
    requests.push({ server, token });
    return { ok: true as const, status: 204, body: null, headers: {} };
  } };
  const platform = { getExpoPushTokenAsync: async () => ({ type: 'expo' as const, data: 'token-a' }) };

  await registerPushToken({ notifications: platform, api, kv: storage.kv,
    activeServer: () => server });
  await registerPushToken({ notifications: platform, api, kv: storage.kv,
    activeServer: () => server });
  server = 'reserve';
  await registerPushToken({ notifications: platform, api, kv: storage.kv,
    activeServer: () => server });

  expect(requests).toEqual([
    { server: 'primary', token: 'token-a' }, { server: 'reserve', token: 'token-a' },
  ]);
  storage.driver.close();
});

test('P5-8 token registration quietly skips an unavailable token', async () => {
  const storage = await notificationStorage();
  const api = { request: jest.fn() };
  const notifications = { getExpoPushTokenAsync: async () => {
    throw new Error('No Expo project id configured');
  } };

  await registerPushToken({ notifications, api, kv: storage.kv,
    activeServer: () => 'primary' });

  expect(api.request).not.toHaveBeenCalled();
  expect(storage.kv.get(serverKey('push_token_sent', 'primary'))).toBeNull();
  storage.driver.close();
});

test('P5-8 failed token upload is retried and not recorded', async () => {
  const storage = await notificationStorage();
  const api = { request: jest.fn(async () => ({
    ok: false as const, status: 500, body: null, headers: {},
  })) };
  const notifications = { getExpoPushTokenAsync: async () => ({
    type: 'expo' as const, data: 'token-a',
  }) };

  await registerPushToken({ notifications, api, kv: storage.kv,
    activeServer: () => 'primary' });
  await registerPushToken({ notifications, api, kv: storage.kv,
    activeServer: () => 'primary' });

  expect(api.request).toHaveBeenCalledTimes(2);
  expect(storage.kv.get(serverKey('push_token_sent', 'primary'))).toBeNull();
  storage.driver.close();
});

test('P5-8 together completion cancels its reminder and records suppression', async () => {
  const storage = await notificationStorage();
  const factory = rowFactories(storage.clock, sequentialIds());
  const task = factory.task_templates({ id: factory.taskId, completion_mode: 'together' });
  const replica = new ReplicaRepo(storage.driver);
  replica.upsert('task_templates', task, { pending: false, deleted: false, pullGen: 0 });
  const cancelled: string[] = [];
  await handlePushTask({ driver: storage.driver, notifications: {
    cancelScheduledNotificationAsync: async (id: string) => { cancelled.push(id); },
  } }, pushBody({ notification: null, data: { dataString: JSON.stringify({
    type: 'completion', task_id: task.id, occurrence_key: '2026-10-13T08:00',
  }) } }));
  expect(cancelled).toEqual([`rem:${task.id}:2026-10-13T08:00`]);
  expect(storage.kv.get('suppressed_reminders')).toBe(
    JSON.stringify([`rem:${task.id}:2026-10-13T08:00`]),
  );
  storage.driver.close();
});

test('P5-8 per_pet completion leaves its reminder alone', async () => {
  const storage = await notificationStorage();
  const factory = rowFactories(storage.clock, sequentialIds());
  const task = factory.task_templates({ id: factory.taskId, completion_mode: 'per_pet' });
  new ReplicaRepo(storage.driver).upsert('task_templates', task,
    { pending: false, deleted: false, pullGen: 0 });
  const cancel = jest.fn();
  await handlePushTask({ driver: storage.driver,
    notifications: { cancelScheduledNotificationAsync: cancel },
  }, pushBody({ notification: null, data: { dataString: JSON.stringify({
    type: 'completion', task_id: task.id, occurrence_key: '2026-10-13T08:00',
  }) } }));
  expect(cancel).not.toHaveBeenCalled();
  storage.driver.close();
});

test('P5-8 ignores a message about my own action', async () => {
  const storage = await notificationStorage();
  storage.kv.set('session_user', JSON.stringify({ id: 'member-me' }));
  const cancel = jest.fn();
  await handlePushTask({ driver: storage.driver,
    notifications: { cancelScheduledNotificationAsync: cancel },
  }, pushBody({ notification: null, data: { dataString: JSON.stringify({
    type: 'completion', author_id: 'member-me', task_id: 'task',
    occurrence_key: '2026-10-13T08:00',
  }) } }));
  expect(cancel).not.toHaveBeenCalled();
  expect(new Kv(storage.driver).get('suppressed_reminders')).toBeNull();
  storage.driver.close();
});

test('P5-8 ignores malformed notification data', async () => {
  const storage = await notificationStorage();
  const cancel = jest.fn();
  await handlePushTask({ driver: storage.driver,
    notifications: { cancelScheduledNotificationAsync: cancel },
  }, pushBody({ notification: null, data: { dataString: '{not-json' } }));
  expect(cancel).not.toHaveBeenCalled();
  storage.driver.close();
});

test('P5-8 ignores a notification tap payload', async () => {
  const storage = await notificationStorage();
  const cancel = jest.fn();
  const tapPayload = { actionIdentifier: 'expo.notifications.DEFAULT_ACTION',
    notification: {} } as NotificationTaskPayload;
  await handlePushTask({ driver: storage.driver,
    notifications: { cancelScheduledNotificationAsync: cancel } }, pushBody(tapPayload));
  expect(cancel).not.toHaveBeenCalled();
  storage.driver.close();
});
