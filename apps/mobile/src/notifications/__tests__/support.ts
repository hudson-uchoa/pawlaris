import { planReminders, type ReminderItem } from '@pawlaris/shared';
import type { NotificationRequest } from 'expo-notifications';
import { Kv } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { createReplicaApply, hydrateReplica } from '../../replica/apply';
import { createReplicaStore } from '../../replica/store';
import { fakeClock } from '../../testing/fakeClock';
import { fakeNotifications } from '../../testing/fakeNotifications';
import { memoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';

export async function notificationStorage(data?: Uint8Array) {
  const driver = await memoryDriver(data);
  openDatabase(driver);
  return { driver, kv: new Kv(driver), clock: fakeClock(Date.parse('2026-10-13T10:00:00Z')),
    notifications: fakeNotifications() };
}

export async function reminderContext() {
  const c = await notificationStorage();
  const factory = rowFactories(c.clock, sequentialIds());
  const store = createReplicaStore();
  const apply = createReplicaApply({ driver: c.driver, store, clock: c.clock });
  const pet = factory.pets({ id: factory.petId });
  const task = factory.task_templates({ id: factory.taskId,
    recurrence: { freq: 'once', date: '2026-10-13' }, pet_ids: [pet.id] });
  const health = factory.health_events({ pet_id: pet.id, next_due_on: '2026-10-13' });
  const timer = factory.task_timers({ task_id: task.id });
  apply.applyServerRows([
    { entity: 'family', row: factory.family() },
    { entity: 'pets', row: pet }, { entity: 'task_templates', row: task },
    { entity: 'health_events', row: health }, { entity: 'task_timers', row: timer },
  ]);
  hydrateReplica({ driver: c.driver, store, clock: c.clock });
  const me = () => factory.memberId;
  function desired(): ReminderItem[] {
    const state = store.getState();
    return planReminders({
      now: c.clock.now(), tz: state.family?.timezone ?? 'America/Sao_Paulo', me: me(),
      templates: Object.values(state.taskTemplates), completions: Object.values(state.completions),
      pets: Object.values(state.pets), healthEvents: Object.values(state.healthEvents),
      timers: Object.values(state.timers), suppressedIds: new Set(),
    });
  }
  return { ...c, factory, store, apply, me, task, health, timer, desired,
    dependencies: { clock: c.clock, kv: c.kv, store, me, platform: c.notifications.platform } };
}

export function scheduledRequest(identifier: string, fp: string, kind = 'reminder'): NotificationRequest {
  return { identifier, trigger: null, content: {
    title: 'Existing title', body: 'Existing body', subtitle: null,
    categoryIdentifier: null, sound: null, data: { kind, fp },
  } };
}
