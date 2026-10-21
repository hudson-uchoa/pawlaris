import { strings } from '../../i18n/strings';
import { reconcile } from '../reconcile';
import { reminderContext, scheduledRequest } from './support';

let context: Awaited<ReturnType<typeof reminderContext>>;

beforeEach(async () => { context = await reminderContext(); });
afterEach(() => { context.driver.close(); });

function planned() {
  const desired = context.desired();
  expect(desired).toHaveLength(3);
  expect(desired.map((item) => item.kind).sort()).toEqual(['health_due', 'reminder', 'timer']);
  return desired;
}

test('R3.33 07 section 6 cancels extras from all three owned prefixes and preserves foreign ids', async () => {
  const desired = planned();
  const { notifications } = context;
  for (const item of desired) {
    notifications.scheduled.set(item.id, scheduledRequest(item.id, item.fp, item.kind));
  }
  const extras = ['rem:stale:2026-10-12T08:00', 'due:stale', 'tmr:stale'];
  const foreign = ['other:keep', 'reminder:keep', 'family-activity'];
  for (const id of [...extras, ...foreign]) notifications.scheduled.set(id, scheduledRequest(id, 'old'));

  await reconcile(context.dependencies);

  expect(notifications.cancellations.sort()).toEqual(extras.sort());
  expect(notifications.schedules).toEqual([]);
  expect([...notifications.scheduled.keys()].sort()).toEqual([...desired.map((item) => item.id), ...foreign].sort());
});

test('R3.32 R3.33 07 section 6 schedules missing task health and timer notifications from the replica', async () => {
  const desired = planned();
  const { notifications } = context;
  const foreign = scheduledRequest('other:keep', 'foreign');
  notifications.scheduled.set(foreign.identifier, foreign);

  await reconcile(context.dependencies);

  expect(notifications.cancellations).toEqual([]);
  expect(notifications.schedules).toHaveLength(3);
  for (const item of desired) {
    const request = notifications.schedules.find((row) => row.identifier === item.id);
    const text = item.kind === 'reminder'
      ? { title: context.task.title, body: 'Aurora' }
      : item.kind === 'health_due'
        ? { title: context.health.title, body: strings.notifications.healthDueBody('Aurora') }
        : { title: strings.notifications.timerTitle, body: context.task.title };
    expect(request).toMatchObject({ identifier: item.id,
      content: { ...text, data: { fp: item.fp, kind: item.kind } },
      trigger: { type: 'date', channelId: item.channel },
    });
    const trigger = request?.trigger;
    if (trigger === undefined || trigger === null || !('type' in trigger) || trigger.type !== 'date') {
      throw new Error('Expected an exact date trigger');
    }
    expect(trigger.date instanceof Date ? trigger.date.getTime() : trigger.date).toBe(item.fireAt);
  }
  expect(notifications.scheduled.get(foreign.identifier)).toEqual(foreign);
});

test('R3.33 07 section 6 re-schedules each owned id whose fp changed', async () => {
  const desired = planned();
  const { notifications } = context;
  for (const item of desired) {
    notifications.scheduled.set(item.id, scheduledRequest(item.id, `old-${item.fp}`, item.kind));
  }

  await reconcile(context.dependencies);

  expect(notifications.cancellations.sort()).toEqual(desired.map((item) => item.id).sort());
  expect(notifications.schedules.map((request) => request.identifier).sort()).toEqual(desired.map((item) => item.id).sort());
  for (const item of desired) {
    expect(notifications.scheduled.get(item.id)?.content.data?.fp).toBe(item.fp);
  }
});

test('R3.33 07 section 6 running twice changes nothing after the first reconciliation', async () => {
  const desired = planned();
  const { notifications } = context;
  await reconcile(context.dependencies);
  expect(notifications.schedules).toHaveLength(desired.length);
  const before = await notifications.platform.getAllScheduledNotificationsAsync();
  notifications.resetWrites();

  await reconcile(context.dependencies);

  expect(notifications.schedules).toEqual([]);
  expect(notifications.cancellations).toEqual([]);
  expect(await notifications.platform.getAllScheduledNotificationsAsync()).toEqual(before);
});

test('R3.34 09 section 9.4 persisted suppressed ids stay absent while the replica has no completion', async () => {
  const desired = planned();
  const reminder = desired.find((item) => item.kind === 'reminder');
  if (reminder === undefined) throw new Error('The reminder fixture is missing');
  context.kv.set('suppressed_reminders', JSON.stringify([reminder.id]));
  context.clock.advance(1_000);

  await reconcile(context.dependencies);

  expect(context.notifications.schedules.map((request) => request.identifier).sort())
    .toEqual(desired.filter((item) => item.id !== reminder.id).map((item) => item.id).sort());
  expect(context.kv.get('suppressed_reminders')).toBe(JSON.stringify([reminder.id]));
  expect(Object.values(context.store.getState().completions)).toEqual([]);
});
