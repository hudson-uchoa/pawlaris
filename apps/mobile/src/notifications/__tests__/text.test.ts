import { planReminders, type ReminderItem } from '@pawlaris/shared';
import { strings } from '../../i18n/strings';
import { fakeClock } from '../../testing/fakeClock';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { reminderText } from '../text';

const clock = fakeClock(Date.parse('2026-10-13T10:00:00Z'));
const factory = rowFactories(clock, sequentialIds());
const firstPet = factory.pets({ name: 'Aurora' });
const pets = [firstPet, factory.pets({ name: 'Asteria' })];
const task = factory.task_templates({ id: factory.taskId, title: 'Breakfast',
  pet_ids: pets.map((pet) => pet.id), recurrence: { freq: 'once', date: '2026-10-13' } });
const health = factory.health_events({ pet_id: firstPet.id, title: 'Vaccine booster',
  next_due_on: '2026-10-13' });
const items = planReminders({ now: clock.now(), tz: 'America/Sao_Paulo', me: factory.memberId,
  templates: [task], completions: [], pets, healthEvents: [health],
  timers: [factory.task_timers({ task_id: task.id })], suppressedIds: new Set() });

function itemOfKind(kind: ReminderItem['kind']): ReminderItem {
  const item = items.find((candidate) => candidate.kind === kind);
  if (item === undefined) throw new Error(`Missing planner fixture: ${kind}`);
  return item;
}

test('09 section 9.2 task reminder title is the task title and body joins pet names', () => {
  expect(reminderText(itemOfKind('reminder'))).toEqual({ title: task.title, body: 'Aurora, Asteria' });
});

test('R2.11 09 section 9.2 health due title is the event title and body uses Portuguese i18n', () => {
  expect(reminderText(itemOfKind('health_due'))).toEqual({
    title: health.title, body: strings.notifications.healthDueBody('Aurora'),
  });
});

test('R3.29 09 section 9.2 timer title uses Portuguese i18n and body is the task title', () => {
  expect(reminderText(itemOfKind('timer'))).toEqual({ title: strings.notifications.timerTitle, body: task.title });
});
