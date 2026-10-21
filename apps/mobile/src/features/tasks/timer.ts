import type { TaskTemplate } from '@pawlaris/shared';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';

export function remainingTimerMs(endsAt: string, clock: Clock): number {
  return Math.max(0, Date.parse(endsAt) - clock.now());
}

export function startOccurrenceTimer(task: TaskTemplate, occurrenceKey: string, services: {
  clock: Clock; mutations: Pick<Mutations, 'startTimer'>;
}): void {
  if (task.timer_seconds === null) return;
  const now = services.clock.now();
  // Q-59: UI timers cover the whole occurrence, including per-pet tasks.
  services.mutations.startTimer({ task_id: task.id, occurrence_key: occurrenceKey, pet_id: null,
    started_at: new Date(now).toISOString(), ends_at: new Date(now + task.timer_seconds * 1000).toISOString() });
}
