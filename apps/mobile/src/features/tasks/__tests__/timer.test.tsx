import { localDate, type Timer } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { Easing } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatDuration } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { hydrateReplica } from '../../../replica/apply';
import { selectDayView, selectTimerFor } from '../../../replica/selectors';
import { createReplicaStore, type ReplicaStore } from '../../../replica/store';
import { ReplicaProvider, useReplica } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { TaskCard } from '../../dashboard/TaskCard';
import { CountdownRing } from '../CountdownRing';
import { TaskDetailScreen, type TaskDetailServices } from '../TaskDetailScreen';
import { remainingTimerMs } from '../timer';
import { taskContext, type TaskContext } from './support';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);

const timezone = 'America/Sao_Paulo';
const initialAppState = AppState.currentState;
let context: TaskContext | undefined;

beforeEach(() => {
  // Deliberately unrelated to the injected wall clock used by every timer.
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  if (context !== undefined) {
    expect(context.http.requests).toEqual([]);
    expect(context.fileSystem.requests).toEqual([]);
    context.dispose();
  }
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

// Q-59: these cases have one together occurrence, so no target-selection
// policy for multiple slots or pets is assumed by the RED tests.
async function scene(timesOfDay: string[] = []) {
  const c = await taskContext();
  context = c;
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], times_of_day: timesOfDay,
    completion_mode: 'together', timer_seconds: 300 });
  const date = localDate(c.clock.now(), timezone);
  const key = timesOfDay.length === 0 ? date : `${date}T${timesOfDay[0]}`;
  const services: TaskDetailServices = {
    clock: c.clock, sessionUser: c.services.sessionUser, mutations: c.mutations,
    readCompletionRange: (from, to) => c.replica.range('task_completions', from, to).map((record) => record.row),
  };
  return { ...c, task, date, key, detailServices: services };
}

type Scene = Awaited<ReturnType<typeof scene>>;

function seedTimer(c: Scene, overrides: Partial<Timer> = {}): Timer {
  const timer = c.factory.task_timers({ task_id: c.task.id, occurrence_key: c.key,
    started_by: c.sessionUser.id, started_at: new Date(c.clock.now()).toISOString(),
    ends_at: new Date(c.clock.now() + 300_000).toISOString(), ...overrides });
  c.apply.applyServerRows([{ entity: 'task_timers', row: timer }]);
  return timer;
}

function paintDetail(c: Scene, store: ReplicaStore = c.store) {
  return render(<ReplicaProvider store={store}>
    <AssetFilesProvider files={c.files}>
      <TaskDetailScreen taskId={c.task.id} services={c.detailServices} active onEdit={c.onOpenTask} />
    </AssetFilesProvider>
  </ReplicaProvider>);
}

function ReplicaCard({ c }: { c: Scene }) {
  const members = useReplica((state) => state.members);
  const item = useReplica((state) => {
    const day = selectDayView(state, { date: c.date, now: c.clock.now(), me: c.sessionUser.id, scope: 'all' });
    return [...day.overdue, ...day.now, ...day.later, ...day.done]
      .find((row) => row.taskId === c.task.id && row.occurrenceKey === c.key);
  });
  if (item === undefined) throw new Error('The seeded timer occurrence is missing');
  return <TaskCard item={item} members={members} viewerId={c.sessionUser.id} date={c.date}
    timezone={timezone} services={{ clock: c.clock, mutations: c.mutations }} active
    onOpenTask={c.onOpenTask} />;
}

test('TM-1 R3.28 remaining time reads ends_at and the injected clock on each call', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  expect(remainingTimerMs(timer.ends_at, c.clock)).toBe(300_000);
  c.clock.advance(125_250);
  expect(remainingTimerMs(timer.ends_at, c.clock)).toBe(174_750);
  expect(c.replica.get('task_timers', timer.id)?.row).toEqual(timer);
  expect(c.outbox.count()).toBe(0);
});

test.each([
  { elapsed: 125_000, remaining: 175_000 },
  { elapsed: 300_000, remaining: 0 },
  { elapsed: 3 * 24 * 60 * 60 * 1000, remaining: 0 },
])('TM-1 R3.28 rebuilding the replica after $elapsed ms derives $remaining ms without a running process', async ({ elapsed, remaining }) => {
  const c = await scene();
  const timer = seedTimer(c);
  c.clock.advance(elapsed);
  const store = createReplicaStore();
  hydrateReplica({ driver: c.driver, store, clock: c.clock });
  expect(store.getState().timers[timer.id]).toEqual(timer);
  expect(remainingTimerMs(timer.ends_at, c.clock)).toBe(remaining);
  expect(c.outbox.count()).toBe(0);
});

test('R3.31 06 section 4.4 starts one linear withTiming for the remaining milliseconds and does not restart on render', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  c.clock.advance(125_000);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0]?.[0]).toBe(0);
  expect(timing.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ duration: 175_000, easing: Easing.linear }));
  c.clock.advance(1_000);
  await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
  await view.rerender(<CountdownRing timer={{ ...timer }} clock={c.clock} active testID="timer-ring" />);
  expect(timing).toHaveBeenCalledTimes(1);
});

test('R3.31 06 section 4.4 changing ends_at starts one new timing using the current clock', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  expect(timing).toHaveBeenCalledTimes(1);
  c.clock.advance(25_000);
  const changed = { ...timer, ends_at: new Date(c.clock.now() + 120_000).toISOString() };
  await view.rerender(<CountdownRing timer={changed} clock={c.clock} active testID="timer-ring" />);
  expect(timing).toHaveBeenCalledTimes(2);
  expect(timing.mock.calls[1]?.[0]).toBe(0);
  expect(timing.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ duration: 120_000, easing: Easing.linear }));
});

test('R3.27 R3.31 06 section 4.4 draws the countdown ring without creating any setInterval', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  const interval = jest.spyOn(globalThis, 'setInterval');
  const view = await render(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  expect(interval).not.toHaveBeenCalled();
  c.clock.advance(1_000);
  await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
  await view.rerender(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  await view.unmount();
  expect(interval).not.toHaveBeenCalled();
  // An empty stub must not satisfy the no-interval assertion vacuously.
  await render(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  expect(screen.getByTestId('timer-ring', { includeHiddenElements: true })).toBeOnTheScreen();
});

test.each([
  { kind: 'all-day', times: [] },
  { kind: 'timed', times: ['08:00'] },
])('P5-6 09 section 5.3 R5.1 detail starts its sole $kind occurrence offline', async ({ times }) => {
  const c = await scene(times);
  const start = jest.spyOn(c.mutations, 'startTimer'); // Passthrough to the real mutation.
  await paintDetail(c);
  const now = c.clock.now();
  await fireEvent.press(screen.getByTestId('timer-start'));
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]?.[0]).toMatchObject({ task_id: c.task.id, occurrence_key: c.key,
    started_at: new Date(now).toISOString(), ends_at: new Date(now + 300_000).toISOString() });
  const timers = Object.values(c.store.getState().timers);
  expect(timers).toHaveLength(1);
  const timer = timers[0];
  if (timer === undefined) throw new Error('The started timer is missing');
  expect(timer).toMatchObject({ task_id: c.task.id, occurrence_key: c.key, pet_id: null,
    started_by: c.sessionUser.id, cancelled_at: null });
  expect(c.replica.get('task_timers', timer.id)?.row).toEqual(timer);
  expect(c.outbox.count()).toBe(1);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ path: '/timers', method: 'POST', entityId: timer.id });
  expect(screen.getByTestId('timer-cancel')).toBeEnabled();
  expect(Object.values(c.store.getState().completions)).toEqual([]);
});

test('P5-6 09 section 3.3 R5.1 long-press starts the card occurrence with startTimer without completing or opening it', async () => {
  const c = await scene(['08:00']);
  const start = jest.spyOn(c.mutations, 'startTimer');
  await render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}><ReplicaCard c={c} /></AssetFilesProvider>
  </ReplicaProvider>);
  await fireEvent(screen.getByRole('button', { name: c.task.title }), 'longPress');
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]?.[0]).toMatchObject({ task_id: c.task.id, occurrence_key: c.key,
    started_at: new Date(c.clock.now()).toISOString(), ends_at: new Date(c.clock.now() + 300_000).toISOString() });
  const timers = Object.values(c.store.getState().timers);
  expect(timers).toHaveLength(1);
  const timer = timers[0];
  if (timer === undefined) throw new Error('The long-press timer is missing');
  expect(c.replica.get('task_timers', timer.id)?.row).toEqual(timer);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ path: '/timers', entityId: timer.id });
  expect(c.outbox.count()).toBe(1);
  expect(Object.values(c.store.getState().completions)).toEqual([]);
  expect(c.onOpenTask).not.toHaveBeenCalled();
});

test('P5-6 09 section 5.3 cancel calls cancelTimer and persists cancellation offline', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  const cancel = jest.spyOn(c.mutations, 'cancelTimer');
  await paintDetail(c);
  await fireEvent.press(screen.getByTestId('timer-cancel'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith(timer.id);
  expect(c.store.getState().timers[timer.id]?.cancelled_at).toBe(new Date(c.clock.now()).toISOString());
  expect(c.replica.get('task_timers', timer.id)?.row.cancelled_at).toBe(new Date(c.clock.now()).toISOString());
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'POST', path: `/timers/${timer.id}/cancel`,
    entityId: timer.id });
  expect(c.outbox.count()).toBe(1);
  expect(selectTimerFor(c.store.getState(), { taskId: c.task.id, occurrenceKey: c.key,
    petId: null, now: c.clock.now() })).toBeNull();
  expect(screen.getByTestId('timer-start')).toBeEnabled();
});

test('R3.30 09 section 5.3 another member timer shows its initiated-by label and a ticking countdown from the replica', async () => {
  const c = await scene();
  const timer = seedTimer(c, { started_by: c.other.id });
  const start = jest.spyOn(c.mutations, 'startTimer');
  await paintDetail(c);
  expect(screen.getByText(strings.tasks.timerStartedBy(c.other.display_name))).toBeOnTheScreen();
  expect(screen.getByText(formatDuration(300))).toBeOnTheScreen();
  expect(screen.getByTestId('timer-cancel')).toBeEnabled();
  await act(async () => {
    c.clock.advance(1_000);
    await jest.advanceTimersByTimeAsync(1_000);
  });
  expect(screen.getByText(formatDuration(299))).toBeOnTheScreen();
  expect(start).not.toHaveBeenCalled();
  expect(c.store.getState().timers[timer.id]).toEqual(timer);
  expect(c.outbox.count()).toBe(0);
});

test('TM-1 R3.28 detail renders the remaining time from a rebuilt store and an advanced injected clock', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  c.clock.advance(125_000);
  const store = createReplicaStore();
  hydrateReplica({ driver: c.driver, store, clock: c.clock });
  expect(selectTimerFor(store.getState(), { taskId: c.task.id, occurrenceKey: c.key,
    petId: null, now: c.clock.now() })).toEqual(timer);
  await paintDetail(c, store);
  expect(screen.getByText(formatDuration(175))).toBeOnTheScreen();
  expect(screen.queryByText(formatDuration(300))).toBeNull();
  expect(c.outbox.count()).toBe(0);
});
