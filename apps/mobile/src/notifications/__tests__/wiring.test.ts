import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { createAppRuntime, type AppRuntime } from '../../bootstrap';
import { response, servers, wireSession } from '../../auth/__tests__/support';
import { ReplicaRepo } from '../../db/replicaRepo';
import { fakeFileSystem } from '../../testing/fakeFileSystem';
import { fakeHttp } from '../../testing/fakeHttp';
import { fakeLogFiles } from '../../testing/fakeLogFiles';
import { fakeRandom } from '../../testing/fakeRandom';
import { fakeSecretBox } from '../../testing/fakeSecretBox';
import { fakeWebSocket } from '../../testing/fakeWebSocket';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { notificationStorage } from './support';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: jest.fn() },
}));

let c: Awaited<ReturnType<typeof context>>;
let runtime: AppRuntime;
let appListener: ((state: AppStateStatus) => void) | undefined;
const initialState = AppState.currentState;
const epoch = 'notification-test-epoch';

async function context() {
  const storage = await notificationStorage();
  const ids = sequentialIds();
  const factory = rowFactories(storage.clock, ids);
  const http = fakeHttp();
  const secretBox = fakeSecretBox();
  const wire = wireSession('primary');
  storage.kv.set('session_user', JSON.stringify(wire.user));
  storage.kv.set('reseeded_epoch.primary', epoch);
  await secretBox.set('session_tokens.primary', JSON.stringify(wire));
  const replica = new ReplicaRepo(storage.driver);
  const pet = factory.pets({ id: factory.petId });
  const task = factory.task_templates({ id: factory.taskId, recurrence: { freq: 'once', date: '2026-10-13' } });
  for (const [entity, row] of [['family', factory.family()], ['pets', pet], ['task_templates', task]] as const) {
    replica.upsert(entity, row, { pending: false, deleted: false, pullGen: 0 });
  }
  const deps = { ...storage, http, ids, secretBox, servers,
    notifications: storage.notifications.platform, fileSystem: fakeFileSystem(),
    random: fakeRandom(...Array.from({ length: 20 }, () => 0.5)),
    logFiles: fakeLogFiles(), documentDirectory: 'file:///fake/documents/',
    WebSocketImpl: fakeWebSocket().WebSocketImpl, online: false,
  };
  return { ...storage, deps, ids, factory, http, task, pet, wire };
}

async function flush() { await jest.advanceTimersByTimeAsync(0); }

beforeEach(async () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.mocked(NetInfo.addEventListener).mockImplementation(() => () => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appListener = listener as (state: AppStateStatus) => void;
    return { remove() {} };
  });
  c = await context();
  runtime = createAppRuntime(c.deps);
});

afterEach(async () => {
  runtime.dispose();
  await flush();
  c.driver.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialState;
});

test('R3.33 offline foregrounding reconciles; completions, health, timers and pet archive reconcile after commit', async () => {
  runtime.afterFirstPaint();
  await flush();
  const reminderId = `rem:${c.task.id}:2026-10-13T08:00`;
  expect(c.notifications.scheduled.has(reminderId)).toBe(true);
  expect(c.http.requests).toEqual([]);
  c.notifications.scheduled.delete(reminderId);
  appListener?.('background'); appListener?.('active');
  await flush();
  expect(c.notifications.scheduled.has(reminderId)).toBe(true);

  runtime.mutations.createCompletion({ task_id: c.task.id, occurrence_key: '2026-10-13T08:00',
    pet_id: null, completed_at: new Date(c.clock.now()).toISOString(), photo_asset_id: null, note: null });
  await flush();
  expect(c.notifications.scheduled.has(reminderId)).toBe(false);
  const healthId = runtime.mutations.createHealthEvent({ pet_id: c.pet.id, type: 'vaccine',
    title: 'Booster', occurred_at: new Date(c.clock.now()).toISOString(), next_due_on: '2026-10-13' });
  const timerId = runtime.mutations.startTimer({ task_id: c.task.id, occurrence_key: '2026-10-13T08:00',
    started_at: new Date(c.clock.now()).toISOString(), ends_at: new Date(c.clock.now() + 60_000).toISOString() });
  await flush();
  expect(c.notifications.scheduled.has(`due:${healthId}`)).toBe(true);
  expect(c.notifications.scheduled.has(`tmr:${timerId}`)).toBe(true);
  runtime.mutations.archivePet(c.pet.id);
  runtime.mutations.cancelTimer(timerId);
  await flush();
  expect(c.notifications.scheduled.size).toBe(0);
  expect(c.http.requests).toEqual([]);
});

test('R3.33 a rolled-back enqueue never schedules a reminder or shows the rationale', async () => {
  const show = jest.fn();
  runtime.events.on('notification_rationale', show);
  runtime.afterFirstPaint();
  await flush();
  c.notifications.resetWrites();
  expect(() => c.driver.transaction(() => {
    runtime.mutations.createTask({ title: 'Rolled back', pet_ids: [c.pet.id], starts_on: '2026-10-13',
      recurrence: { freq: 'once', date: '2026-10-13' }, times_of_day: ['09:00'] });
    throw new Error('rollback');
  })).toThrow('rollback');
  await flush();
  expect(c.notifications.schedules).toEqual([]);
  expect(show).not.toHaveBeenCalled();
});

test('R3.37 the first offline task creation shows the rationale without a system prompt, only once', async () => {
  const show = jest.fn();
  runtime.events.on('notification_rationale', show);
  runtime.afterFirstPaint();
  await flush();
  for (let i = 0; i < 2; i += 1) {
    runtime.mutations.createTask({ title: 'New task', pet_ids: [c.pet.id], starts_on: '2026-10-13',
      recurrence: { freq: 'once', date: '2026-10-13' } });
    await flush();
  }
  expect(show).toHaveBeenCalledTimes(1);
  expect(c.notifications.permissionRequests).toEqual([]);
  expect(await runtime.notificationPermission.request()).toBe(true);
  await flush();
  expect(c.notifications.permissionRequests).toEqual(['request']);
});

test('R3.34 a changed pull clears suppression before reconciling, while an empty pull preserves it', async () => {
  const reminderId = `rem:${c.task.id}:2026-10-13T08:00`;
  c.kv.set('suppressed_reminders', JSON.stringify([reminderId]));
  runtime.afterFirstPaint();
  await flush();
  expect(c.notifications.scheduled.has(reminderId)).toBe(false);
  const show = jest.fn();
  runtime.events.on('notification_rationale', show);
  const page = (changes: unknown[], revision: number) => response(200, { changes, revision, epoch, has_more: false });
  c.http.enqueue(page([], 1));
  runtime.engine.setOnline(true);
  await flush();
  expect(c.kv.get('suppressed_reminders')).toBe(JSON.stringify([reminderId]));
  expect(show).not.toHaveBeenCalled();
  c.http.enqueue(page([{ entity: 'task_templates', row: { ...c.task, title: 'Updated title', revision: 2 } }], 2));
  await runtime.engine.kick('refresh');
  await flush();
  expect(c.kv.get('suppressed_reminders')).toBeNull();
  expect(c.notifications.scheduled.get(reminderId)?.content.title).toBe('Updated title');
  expect(show).toHaveBeenCalledTimes(1);
  expect(c.notifications.permissionRequests).toEqual([]);
});
