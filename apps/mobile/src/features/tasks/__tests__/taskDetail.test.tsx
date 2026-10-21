import { addDays, localDate, type TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import TaskDetail from '../../../../app/task/[id]';
import Tasks from '../../../../app/tasks';
import { AppProvider } from '../../../appContext';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { servers } from '../../../auth/__tests__/support';
import { createAppRuntime, type AppRuntime } from '../../../bootstrap';
import { formatFullDate, formatScheduleSummary } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { selectDayView } from '../../../replica/selectors';
import { ReplicaProvider } from '../../../replica/useReplica';
import { fakeLogFiles } from '../../../testing/fakeLogFiles';
import { fakeWebSocket } from '../../../testing/fakeWebSocket';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { TaskDetailScreen, type TaskDetailServices } from '../TaskDetailScreen';
import { buildTaskHistory } from '../taskHistory';
import { taskContext, type TaskContext } from './support';

// Replace only the navigation boundary; routes, screens and replicas stay real.
jest.mock('expo-router', () => ({
  useIsFocused: () => true, useLocalSearchParams: jest.fn(), useRouter: jest.fn(),
}));

// Q-58: inclusive pages [today-30, today-1], [today-60, today-31], [today-90, today-61].
const historyWindowAssumption = { pageDays: 30, totalDays: 90, newestDaysAgo: 1 } as const;
const timezone = 'America/Sao_Paulo';
let context: TaskContext | undefined;
let runtime: AppRuntime | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  runtime?.dispose();
  runtime = undefined;
  if (context !== undefined) {
    expect(context.http.requests).toEqual([]);
    expect(context.fileSystem.requests).toEqual([]);
    context.dispose();
  }
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene() {
  const c = await taskContext();
  context = c;
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], starts_on: '2026-06-01',
    times_of_day: ['08:00', '20:00'], assigned_to: c.other.id });
  const services: TaskDetailServices = {
    clock: c.clock, sessionUser: c.services.sessionUser, mutations: c.mutations,
    readCompletionRange: (from, to) => c.replica.range('task_completions', from, to).map((record) => record.row),
  };
  return { ...c, pet, task, detailServices: services, date: localDate(c.clock.now(), timezone) };
}

type Scene = Awaited<ReturnType<typeof scene>>;

async function paint(c: Scene, task: TaskTemplate = c.task, onEdit = jest.fn()) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>
      <TaskDetailScreen taskId={task.id} services={c.detailServices} active onEdit={onEdit} />
    </AssetFilesProvider>
  </ReplicaProvider>);
}

function historyList() {
  return screen.getByTestId('task-history');
}

function historyRows(c: Scene, task: TaskTemplate = c.task) {
  return buildTaskHistory({ task, from: addDays(c.date, -historyWindowAssumption.pageDays),
    to: addDays(c.date, -historyWindowAssumption.newestDaysAgo),
    completions: Object.values(c.store.getState().completions) });
}

function expectedKeys(date: string, days: number, times: readonly string[]): string[] {
  return Array.from({ length: days }, (_, offset) => {
    const day = addDays(date, -offset);
    return times.length === 0 ? [day] : [...times].sort().reverse().map((time) => `${day}T${time}`);
  }).flat();
}

function historyRow(task: TaskTemplate, key: string) {
  return within(screen.getByTestId(`task-history-${task.id}-${key}`));
}

test('P5-4 R1 per-pet history keeps a done row and a not-done row for the same slot', async () => {
  const c = await scene();
  const otherPet = c.seedPet({ name: 'Second pet' });
  const yesterday = addDays(c.date, -1);
  const task = c.seedTask({ pet_ids: [c.pet.id, otherPet.id], completion_mode: 'per_pet',
    starts_on: yesterday, times_of_day: ['08:00'] });
  const key = `${yesterday}T08:00`;
  const done = c.seedCompletion(task, { occurrence_key: key, pet_id: c.pet.id,
    completed_by: c.other.id, completed_at: `${yesterday}T11:02:00.000Z` });
  expect(historyRows(c, task)).toEqual([
    { occurrenceKey: key, petId: c.pet.id, completion: done },
    { occurrenceKey: key, petId: otherPet.id, completion: null },
  ]);
  await paint(c, task);
  expect(within(historyList()).getAllByTestId(new RegExp(`^task-history-${task.id}-${key}`)))
    .toHaveLength(2);
  const finished = within(screen.getByTestId(`task-history-${task.id}-${key}-${c.pet.id}`));
  expect(finished.getByText(c.pet.name)).toBeOnTheScreen();
  expect(finished.getByText(strings.dashboard.completedBy(c.other.display_name, '08:02'))).toBeOnTheScreen();
  expect(finished.queryByText(strings.tasks.notDone)).toBeNull();
  const missed = within(screen.getByTestId(`task-history-${task.id}-${key}-${otherPet.id}`));
  expect(missed.getByText(otherPet.name)).toBeOnTheScreen();
  expect(missed.getByText(strings.tasks.notDone)).toBeOnTheScreen();
  expect(missed.queryByText(strings.dashboard.completedBy(c.other.display_name, '08:02'))).toBeNull();
});

test('P5-4 R2 reseed duplicates cannot replace the canonical history attribution', async () => {
  const c = await scene();
  const yesterday = addDays(c.date, -1);
  const key = `${yesterday}T08:00`;
  const canonical = c.seedCompletion(c.task, { occurrence_key: key, completed_by: c.other.id,
    completed_at: `${yesterday}T11:02:00.000Z` });
  c.seedCompletion(c.task, { occurrence_key: key, duplicate_of: canonical.id,
    completed_by: c.sessionUser.id, completed_at: `${yesterday}T11:03:00.000Z` });
  expect(historyRows(c).filter((row) => row.occurrenceKey === key)).toEqual([
    { occurrenceKey: key, petId: null, completion: canonical },
  ]);
  await paint(c);
  expect(within(historyList()).getAllByTestId(`task-history-${c.task.id}-${key}`)).toHaveLength(1);
  const row = historyRow(c.task, key);
  expect(row.getByText(strings.dashboard.completedBy(c.other.display_name, '08:02'))).toBeOnTheScreen();
  expect(row.queryByText(strings.dashboard.completedBy(c.sessionUser.display_name, '08:03'))).toBeNull();
});

test.each(['local', 'synced'] as const)(
  'P5-4 R3 a %s undo refreshes loaded history rows without remounting', async (source) => {
    const c = await scene();
    const done = [1, 2].map((daysAgo) => {
      const date = addDays(c.date, -daysAgo);
      return c.seedCompletion(c.task, { occurrence_key: `${date}T08:00`,
        completed_by: c.other.id, completed_at: `${date}T11:02:00.000Z` });
    });
    await paint(c);
    const attribution = strings.dashboard.completedBy(c.other.display_name, '08:02');
    for (const completion of done) {
      expect(historyRow(c.task, completion.occurrence_key).getByText(attribution)).toBeOnTheScreen();
    }
    await act(() => {
      if (source === 'local') {
        for (const completion of done) c.mutations.undoCompletion(completion.id);
      } else {
        c.apply.applyServerRows(done.map((completion) => ({ entity: 'task_completions',
          row: { ...completion, undone_at: new Date(c.clock.now()).toISOString(), undone_by: c.sessionUser.id },
        })));
      }
    });
    for (const completion of done) {
      expect(c.replica.get('task_completions', completion.id)?.row).toMatchObject({
        undone_at: new Date(c.clock.now()).toISOString(), undone_by: c.sessionUser.id,
      });
      const row = historyRow(c.task, completion.occurrence_key);
      expect(row.queryByText(strings.tasks.notDone)).toBeOnTheScreen();
      expect(row.queryByText(attribution)).toBeNull();
    }
    expect(c.outbox.count()).toBe(source === 'local' ? done.length : 0);
  },
);

test('P5-4 R4 the today section excludes yesterday carry-over and keeps today slots', async () => {
  const c = await scene();
  const yesterday = addDays(c.date, -1);
  // Carry-over is produced only on a template's unscheduled days.
  const carried = c.seedTask({ pet_ids: [c.pet.id], starts_on: yesterday,
    recurrence: { freq: 'daily', interval: 2 }, times_of_day: ['08:00'] });
  const day = selectDayView(c.store.getState(), {
    date: c.date, now: c.clock.now(), me: c.sessionUser.id, scope: 'all',
  });
  expect(day.overdue).toContainEqual(expect.objectContaining({
    taskId: carried.id, occurrenceKey: `${yesterday}T08:00`, originalDate: yesterday,
  }));
  const view = await paint(c, carried);
  const carriedToday = within(screen.getByTestId('task-today'));
  expect(carriedToday.getByText(strings.dashboard.today)).toBeOnTheScreen();
  expect(carriedToday.queryAllByTestId(/^task-card-/)).toHaveLength(0);
  expect(historyRow(carried, `${yesterday}T08:00`).getByText(strings.tasks.notDone)).toBeOnTheScreen();
  await view.unmount();
  await paint(c);
  const today = within(screen.getByTestId('task-today'));
  expect(today.getAllByTestId(/^task-card-/)).toHaveLength(c.task.times_of_day.length);
  for (const time of c.task.times_of_day) {
    expect(today.getByTestId(`task-card-${c.task.id}-${c.date}T${time}`)).toBeOnTheScreen();
  }
  expect(today.queryByTestId(`task-card-${carried.id}-${yesterday}T08:00`)).toBeNull();
});

test('P5-4 R5 history shows a local photo only when the completion has a photo asset', async () => {
  const c = await scene();
  const yesterday = addDays(c.date, -1);
  const id = c.ids.uuid();
  const uri = `file:///fake/documents/assets/${id}.jpg`;
  c.fileSystem.write(uri, new Uint8Array([1, 2, 3]));
  // Render the stored capture offline, with the upload worker stopped.
  c.files.uploads.dispose();
  c.files.registerCapture({ id, kind: 'task_proof', localUri: uri, sha256: 'a'.repeat(64) });
  const withPhoto = c.seedCompletion(c.task, { occurrence_key: `${yesterday}T08:00`, photo_asset_id: id });
  const withoutPhoto = c.seedCompletion(c.task, { occurrence_key: `${yesterday}T20:00`, photo_asset_id: null });
  await paint(c);
  const photoRow = historyRow(c.task, withPhoto.occurrence_key);
  expect(photoRow.getByText(withPhoto.title_snapshot)).toBeOnTheScreen();
  expect(photoRow.queryByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri }]);
  const plainRow = historyRow(c.task, withoutPhoto.occurrence_key);
  expect(plainRow.getByText(withoutPhoto.title_snapshot)).toBeOnTheScreen();
  expect(plainRow.queryByRole('image')).toBeNull();
});

test('P5-4 R3.24 history lists done and not-done slots for the last 30 family dates newest first', async () => {
  const c = await scene();
  const yesterday = addDays(c.date, -historyWindowAssumption.newestDaysAgo);
  const doneKey = `${yesterday}T08:00`;
  const done = c.seedCompletion(c.task, { occurrence_key: doneKey, completed_by: c.other.id,
    completed_at: `${yesterday}T11:02:00.000Z` });
  const oldest = addDays(c.date, -historyWindowAssumption.pageDays);
  const boundary = c.seedCompletion(c.task, { occurrence_key: `${oldest}T20:00`,
    completed_by: c.other.id, completed_at: `${oldest}T23:02:00.000Z` });
  c.seedCompletion(c.task, { occurrence_key: `${addDays(oldest, -1)}T20:00` });
  c.seedCompletion(c.task, { occurrence_key: `${c.date}T08:00` });
  c.seedCompletion(c.seedTask({ pet_ids: [c.pet.id] }), { occurrence_key: doneKey });
  const rows = historyRows(c);
  expect(rows.map((row) => row.occurrenceKey)).toEqual(
    expectedKeys(yesterday, historyWindowAssumption.pageDays, c.task.times_of_day),
  );
  expect(rows.some((row) => row.occurrenceKey.startsWith(c.date))).toBe(false);
  expect(rows.filter((row) => row.completion !== null).map((row) => row.completion?.id))
    .toEqual([done.id, boundary.id]);
  await paint(c);
  const finished = historyRow(c.task, doneKey);
  expect(finished.getByText(formatFullDate(yesterday))).toBeOnTheScreen();
  expect(finished.getByText('08:00')).toBeOnTheScreen();
  expect(finished.getByText(strings.dashboard.completedBy(c.other.display_name, '08:02'))).toBeOnTheScreen();
  const missed = historyRow(c.task, `${yesterday}T20:00`);
  expect(missed.getByText(formatFullDate(yesterday))).toBeOnTheScreen();
  expect(missed.getByText('20:00')).toBeOnTheScreen();
  expect(missed.getByText(strings.tasks.notDone)).toBeOnTheScreen();
  for (const time of c.task.times_of_day) {
    expect(within(historyList()).queryByTestId(`task-history-${c.task.id}-${c.date}T${time}`)).toBeNull();
  }
  expect(c.outbox.count()).toBe(0);
});

test('P5-4 R3.22 undone completions are absent and their scheduled slot is not done', async () => {
  const c = await scene();
  const yesterday = addDays(c.date, -historyWindowAssumption.newestDaysAgo);
  const key = `${yesterday}T20:00`;
  const undone = c.seedCompletion(c.task, { occurrence_key: key, completed_by: c.other.id,
    completed_at: `${yesterday}T23:02:00.000Z`, undone_at: `${yesterday}T23:10:00.000Z`,
    undone_by: c.sessionUser.id });
  const live = c.seedCompletion(c.task, { occurrence_key: `${yesterday}T08:00`,
    completed_by: c.other.id, completed_at: `${yesterday}T11:02:00.000Z` });
  const rows = historyRows(c);
  expect(rows).toHaveLength(historyWindowAssumption.pageDays * 2);
  expect(rows.filter((row) => row.occurrenceKey === key)).toEqual([
    expect.objectContaining({ completion: null }),
  ]);
  expect(rows.some((row) => row.completion?.id === undone.id)).toBe(false);
  expect(rows.some((row) => row.completion?.id === live.id)).toBe(true);
  await paint(c);
  const missed = historyRow(c.task, key);
  expect(missed.getByText(strings.tasks.notDone)).toBeOnTheScreen();
  expect(missed.queryByText(strings.dashboard.completedBy(c.other.display_name, '20:02'))).toBeNull();
  expect(c.outbox.count()).toBe(0);
});

test('P5-4 R3.15 scrolling loads 30-day SQLite ranges without gaps or duplicates and stops at 90 days', async () => {
  const c = await scene();
  const task = c.seedTask({ pet_ids: [c.pet.id], starts_on: '2026-06-01', times_of_day: ['23:59'] });
  const page = historyWindowAssumption.pageDays;
  // Persist these rows only on disk, so a memory-only implementation cannot pass.
  const diskRows = [page, page + 1, page * 2, page * 2 + 1, historyWindowAssumption.totalDays,
    historyWindowAssumption.totalDays + 1].map((offset) => c.factory.task_completions({
    task_id: task.id, occurrence_key: `${addDays(c.date, -offset)}T23:59`,
    completed_by: c.other.id, completed_at: `${addDays(c.date, -offset + 1)}T03:01:00.000Z`,
  }));
  c.driver.transaction(() => {
    for (const row of diskRows) c.replica.upsert('task_completions', row,
      { pending: false, deleted: false, pullGen: 0 });
  });
  expect(Object.keys(c.store.getState().completions)).toEqual([]);
  const range = jest.spyOn(c.replica, 'range'); // Passthrough to real SQLite.
  const read = jest.spyOn(c.detailServices, 'readCompletionRange');
  await paint(c, task);
  expect(historyList()).toBeOnTheScreen();
  const yesterday = addDays(c.date, -historyWindowAssumption.newestDaysAgo);
  expect(range.mock.calls).toContainEqual([
    'task_completions', addDays(c.date, -page), expect.stringMatching(new RegExp(`^${yesterday}`)),
  ]);
  expect(historyRow(task, `${yesterday}T23:59`).getByText(strings.tasks.notDone)).toBeOnTheScreen();
  expect(within(historyList()).queryByTestId(`task-history-${task.id}-${c.date}T23:59`)).toBeNull();
  for (const days of [page * 2, historyWindowAssumption.totalDays]) {
    const callsBefore = range.mock.calls.length;
    const readsBefore = read.mock.calls.length;
    await fireEvent(historyList(), 'endReached', { distanceFromEnd: 0 });
    const from = addDays(c.date, -days);
    const through = addDays(c.date, page - days - historyWindowAssumption.newestDaysAgo);
    expect(range.mock.calls.slice(callsBefore)).toContainEqual([
      'task_completions', from, expect.stringMatching(new RegExp(`^${through}`)),
    ]);
    const fetched = read.mock.results.slice(readsBefore).flatMap((result) => {
      if (result.type !== 'return') throw new Error('History SQLite read did not return');
      return result.value;
    });
    const rows = buildTaskHistory({ task, from, to: through, completions: fetched });
    expect(rows.map((row) => row.occurrenceKey)).toEqual(expectedKeys(through, page, ['23:59']));
    expect(rows.filter((row) => row.completion !== null).map((row) => row.completion?.id))
      .toEqual(diskRows.filter((row) => row.occurrence_key >= from && row.occurrence_key <= `${through}T23:59`)
        .map((row) => row.id));
    if (days === historyWindowAssumption.totalDays) {
      const oldest = addDays(c.date, -historyWindowAssumption.totalDays);
      expect(rows[rows.length - 1]).toMatchObject({ occurrenceKey: `${oldest}T23:59`,
        completion: { id: diskRows.find((row) => row.occurrence_key === `${oldest}T23:59`)?.id } });
      expect(rows.some((row) => row.occurrenceKey < oldest)).toBe(false);
    }
  }
  const callsAtLimit = range.mock.calls.length;
  await fireEvent(historyList(), 'endReached', { distanceFromEnd: 0 });
  expect(range).toHaveBeenCalledTimes(callsAtLimit);
  expect(c.outbox.count()).toBe(0);
});

test('P5-4 R3.8 a forked template history starts at its own starts_on and excludes predecessor completions', async () => {
  const c = await scene();
  const old = c.seedTask({ pet_ids: [c.pet.id], starts_on: '2026-09-01', ends_on: '2026-10-04' });
  const fork = c.seedTask({ pet_ids: [c.pet.id], starts_on: '2026-10-05',
    replaces_task_id: old.id, times_of_day: ['08:00'] });
  c.seedCompletion(old, { occurrence_key: '2026-10-04T08:00' });
  c.seedCompletion(old, { occurrence_key: '2026-10-05T08:00' });
  const own = c.seedCompletion(fork, { occurrence_key: '2026-10-05T08:00', completed_by: c.other.id });
  const range = jest.spyOn(c.replica, 'range');
  const rows = historyRows(c, fork);
  const yesterday = addDays(c.date, -historyWindowAssumption.newestDaysAgo);
  expect(rows.map((row) => row.occurrenceKey)).toEqual(expectedKeys(yesterday, 8, ['08:00']));
  expect(rows.filter((row) => row.completion !== null).map((row) => row.completion?.id)).toEqual([own.id]);
  await paint(c, fork);
  expect(range.mock.calls).toContainEqual([
    'task_completions', fork.starts_on, expect.stringMatching(new RegExp(`^${yesterday}`)),
  ]);
  const callsAtStart = range.mock.calls.length;
  await fireEvent(historyList(), 'endReached', { distanceFromEnd: 0 });
  expect(range).toHaveBeenCalledTimes(callsAtStart);
  expect(c.outbox.count()).toBe(0);
});

test('P5-4 R3.14 all-day history uses date-only occurrence keys', async () => {
  const c = await scene();
  const task = c.seedTask({ pet_ids: [c.pet.id], starts_on: '2026-06-01', times_of_day: [] });
  const yesterday = addDays(c.date, -historyWindowAssumption.newestDaysAgo);
  const done = c.seedCompletion(task, { occurrence_key: yesterday, completed_by: c.other.id,
    completed_at: `${yesterday}T11:02:00.000Z` });
  c.seedCompletion(task, { occurrence_key: c.date });
  const rows = historyRows(c, task);
  expect(rows.map((row) => row.occurrenceKey)).toEqual(
    expectedKeys(yesterday, historyWindowAssumption.pageDays, []),
  );
  expect(rows.some((row) => row.occurrenceKey === c.date)).toBe(false);
  expect(rows[0]).toMatchObject({ completion: { id: done.id } });
  await paint(c, task);
  expect(historyRow(task, yesterday).getByText(strings.dashboard.completedBy(c.other.display_name, '08:02')))
    .toBeOnTheScreen();
});

test('P5-4 R1.19 R5.1 detail shows metadata, edit and only this template today even when assigned to another member', async () => {
  const c = await scene();
  const otherTask = c.seedTask({ title: 'Other task', pet_ids: [c.pet.id] });
  const onEdit = jest.fn();
  await paint(c, c.task, onEdit);
  expect(screen.getByText(strings.tasks.categories[c.task.category])).toBeOnTheScreen();
  expect(screen.getByText(formatScheduleSummary({ recurrence: c.task.recurrence, timesOfDay: c.task.times_of_day })))
    .toBeOnTheScreen();
  expect(screen.getAllByText(c.pet.name).length).toBeGreaterThan(0);
  expect(screen.getAllByText(c.other.display_name).length).toBeGreaterThan(0);
  const today = within(screen.getByTestId('task-today'));
  expect(today.getByText(strings.dashboard.today)).toBeOnTheScreen();
  for (const time of c.task.times_of_day) {
    expect(today.getByTestId(`task-card-${c.task.id}-${c.date}T${time}`)).toBeOnTheScreen();
    expect(today.getByTestId(`task-check-${c.task.id}-${c.date}T${time}`)).toBeEnabled();
  }
  expect(today.queryByTestId(`task-card-${otherTask.id}-${c.date}T08:00`)).toBeNull();
  await fireEvent.press(screen.getByTestId('task-edit'));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledWith(c.task.id);
  expect(c.outbox.count()).toBe(0);
});

function navigation() {
  const push = jest.fn<void, [unknown]>();
  jest.mocked(useRouter).mockReturnValue({ push, back: jest.fn(), navigate: jest.fn(),
    replace: jest.fn(), dismiss: jest.fn(), dismissAll: jest.fn(), dismissTo: jest.fn(),
    canGoBack: () => true, canDismiss: () => false, setParams: jest.fn(), prefetch: jest.fn(), reload: jest.fn(),
  });
  return push;
}

function routeTree(c: Scene, children: ReactNode) {
  runtime ??= createAppRuntime({ ...c, servers, online: false,
    WebSocketImpl: fakeWebSocket().WebSocketImpl, logFiles: fakeLogFiles(),
    documentDirectory: 'file:///fake/documents/', perfOutput: jest.fn(),
  });
  return <AppProvider runtime={runtime}>{children}</AppProvider>;
}

test('P5-4 task list row opens task detail instead of the edit form', async () => {
  const c = await scene();
  const push = navigation();
  await render(routeTree(c, <Tasks />));
  await fireEvent.press(screen.getByRole('button', { name: c.task.title }));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith({
    pathname: expect.stringMatching(/task\/\[id\]$/), params: { id: c.task.id },
  });
});

test('P5-4 task detail route reads the id and its edit action opens the matching edit form', async () => {
  const c = await scene();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: c.task.id });
  const push = navigation();
  await render(routeTree(c, <TaskDetail />));
  const today = within(screen.getByTestId('task-today'));
  expect(today.getByTestId(`task-card-${c.task.id}-${c.date}T08:00`)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('task-edit'));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith({
    pathname: expect.stringMatching(/task\/\[id\]\/edit$/), params: { id: c.task.id },
  });
});
