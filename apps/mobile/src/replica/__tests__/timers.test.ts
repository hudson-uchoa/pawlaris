import { memoryDriver } from '../../testing/memoryDriver';
import { hydrate } from '../hydrate';
import { selectTimerFor } from '../selectors';
import { createReplicaStore } from '../store';
import { replicaContext, type ReplicaContext } from './support';

let context: ReplicaContext | undefined;
beforeEach(async () => { context = await replicaContext(); });
afterEach(() => { context?.driver.close(); context = undefined; });

function current(): ReplicaContext {
  if (context === undefined) throw new Error('Replica test context is missing');
  return context;
}

test('TM-1: a timer rehydrated after a restart derives its remaining time from the advanced clock',
  async () => {
    const ctx = current();
    const timer = ctx.factory.task_timers({
      ends_at: new Date(ctx.clock.now() + 300_000).toISOString(), revision: null,
    });
    ctx.apply.applyLocalRow('task_timers', timer);
    ctx.clock.advance(125_000);
    const reopened = await memoryDriver(ctx.driver.export());
    try {
      const store = createReplicaStore();
      hydrate({ driver: reopened, store, clock: ctx.clock });
      const selected = selectTimerFor(store.getState(), {
        taskId: timer.task_id, occurrenceKey: timer.occurrence_key,
        petId: timer.pet_id, now: ctx.clock.now(),
      });
      expect(selected).toEqual(timer);
      if (selected === null) throw new Error('Rehydrated timer is missing');
      expect(Date.parse(selected.ends_at) - ctx.clock.now()).toBe(175_000);
      expect(store.getState().pending[`task_timers:${timer.id}`]).toBe(true);
    } finally {
      reopened.close();
    }
  },
);

test('TM-1 selection: cancelled timers and other occurrences or pets cannot win', () => {
  const ctx = current();
  const active = ctx.factory.task_timers();
  const later = new Date(ctx.clock.now() + 600_000).toISOString();
  const candidates = [
    active,
    ctx.factory.task_timers({ ends_at: later, cancelled_at: active.started_at }),
    ctx.factory.task_timers({ ends_at: later, task_id: ctx.ids.uuid() }),
    ctx.factory.task_timers({ ends_at: later, occurrence_key: '2026-10-14T08:00' }),
    ctx.factory.task_timers({ ends_at: later, pet_id: ctx.ids.uuid() }),
  ];
  ctx.apply.applyServerRows(candidates.map((row) => ({ entity: 'task_timers', row })));
  expect(selectTimerFor(ctx.store.getState(), {
    taskId: active.task_id, occurrenceKey: active.occurrence_key,
    petId: null, now: ctx.clock.now(),
  })).toEqual(active);
});

test('TM-1 selection: the non-cancelled timer with the latest ends_at wins', () => {
  const ctx = current();
  const first = ctx.factory.task_timers();
  const latest = ctx.factory.task_timers({ ends_at: new Date(ctx.clock.now() + 120_000).toISOString() });
  ctx.apply.applyServerRows([{ entity: 'task_timers', row: latest }, { entity: 'task_timers', row: first }]);
  expect(selectTimerFor(ctx.store.getState(), {
    taskId: first.task_id, occurrenceKey: first.occurrence_key,
    petId: null, now: ctx.clock.now(),
  })).toEqual(latest);
});

test.each([59_999, 60_000, 60_001])(
  'TM-1 selection: a timer expired %i ms ago observes the strict sixty-second display window',
  (expiredMs) => {
    const ctx = current();
    const timer = ctx.factory.task_timers();
    ctx.apply.applyServerRows([{ entity: 'task_timers', row: timer }]);
    ctx.clock.advance(60_000 + expiredMs);
    expect(selectTimerFor(ctx.store.getState(), {
      taskId: timer.task_id, occurrenceKey: timer.occurrence_key,
      petId: null, now: ctx.clock.now(),
    })).toEqual(expiredMs < 60_000 ? timer : null);
    expect(ctx.replica.get('task_timers', timer.id)?.row).toEqual(timer);
  },
);

test('TM-1 selection: an occurrence without a timer returns null', () => {
  const ctx = current();
  expect(selectTimerFor(ctx.store.getState(), {
    taskId: ctx.factory.taskId, occurrenceKey: '2026-10-13T08:00',
    petId: null, now: ctx.clock.now(),
  })).toBeNull();
});
