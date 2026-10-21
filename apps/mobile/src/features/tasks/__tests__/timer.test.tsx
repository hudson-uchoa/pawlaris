import { addDays, localDate, type Timer } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
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
import * as Theme from '../../../ui/theme';
import { dark, light } from '../../../ui/tokens/color';
import { TaskCard } from '../../dashboard/TaskCard';
import { CountdownRing } from '../CountdownRing';
import { TaskDetailScreen, type TaskDetailServices } from '../TaskDetailScreen';
import { remainingTimerMs } from '../timer';
import { taskContext, type TaskContext } from './support';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);

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

// The original RED cases use a single together occurrence. Q-59 coverage
// below also seeds multiple slots, per-pet progress and days without targets.
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

test('Q-59 multi-slot per-pet detail starts the first incomplete key with pet_id null', async () => {
  const c = await scene(['20:00', '08:00', '12:00']);
  const secondPet = c.seedPet();
  const petIds = [...c.task.pet_ids, secondPet.id];
  c.apply.applyServerRows([{ entity: 'task_templates', row: { ...c.task,
    completion_mode: 'per_pet', pet_ids: petIds } }]);
  for (const petId of petIds) c.seedCompletion(c.task, { occurrence_key: `${c.date}T08:00`, pet_id: petId });
  c.seedCompletion(c.task, { occurrence_key: `${c.date}T12:00`, pet_id: secondPet.id });
  const start = jest.spyOn(c.mutations, 'startTimer');
  await paintDetail(c);
  await fireEvent.press(screen.getByTestId('timer-start'));
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ occurrence_key: `${c.date}T12:00`, pet_id: null }));
  expect(c.outbox.count()).toBe(1);
});

test('Q-59 a multi-slot card starts its own later occurrence with pet_id null', async () => {
  const c = await scene(['20:00', '08:00']);
  const start = jest.spyOn(c.mutations, 'startTimer');
  await render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}><ReplicaCard c={c} /></AssetFilesProvider>
  </ReplicaProvider>);
  await fireEvent(screen.getByRole('button', { name: c.task.title }), 'longPress');
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ occurrence_key: `${c.date}T20:00`, pet_id: null }));
  await fireEvent(screen.getByRole('button', { name: c.task.title }), 'longPress');
  expect(start).toHaveBeenCalledTimes(1);
  expect(c.onOpenTask).not.toHaveBeenCalled();
  expect(Object.values(c.store.getState().completions)).toEqual([]);
});

test('Q-59 03 section 6 detail shows the latest eligible timer across today before offering a start', async () => {
  const c = await scene(['08:00', '20:00']);
  seedTimer(c, { ends_at: new Date(c.clock.now() + 120_000).toISOString() });
  const latest = seedTimer(c, { occurrence_key: `${c.date}T20:00`, started_by: c.other.id });
  seedTimer(c, { ends_at: new Date(c.clock.now() + 600_000).toISOString(),
    cancelled_at: new Date(c.clock.now()).toISOString() });
  seedTimer(c, { occurrence_key: addDays(c.date, -1), ends_at: new Date(c.clock.now() + 900_000).toISOString() });
  c.seedCompletion(c.task, { occurrence_key: `${c.date}T20:00`, pet_id: null });
  const cancel = jest.spyOn(c.mutations, 'cancelTimer');
  await paintDetail(c);
  expect(screen.queryByTestId('timer-start')).toBeNull();
  expect(screen.getByText(formatDuration(300))).toBeOnTheScreen();
  expect(screen.getByText(strings.tasks.timerStartedBy(c.other.display_name))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('timer-cancel'));
  expect(cancel).toHaveBeenCalledWith(latest.id);
  expect(screen.getByText(formatDuration(120))).toBeOnTheScreen();
});

test('Q-59 empty day keeps the timer section without a start target', async () => {
  const c = await scene();
  const tomorrow = addDays(c.date, 1);
  c.apply.applyServerRows([{ entity: 'task_templates', row: { ...c.task,
    starts_on: tomorrow, recurrence: { freq: 'once', date: tomorrow } } }]);
  const start = jest.spyOn(c.mutations, 'startTimer');
  await paintDetail(c);
  expect(screen.getByRole('header', { name: strings.tasks.timer })).toBeOnTheScreen();
  expect(screen.queryByTestId('timer-start')).toBeNull();
  expect(screen.queryByTestId('timer-cancel')).toBeNull();
  expect(start).not.toHaveBeenCalled();
  expect(c.outbox.count()).toBe(0);
});

test('Q-59 a fully completed day has no start target', async () => {
  const c = await scene(['08:00', '20:00']);
  for (const time of c.task.times_of_day) c.seedCompletion(c.task, { occurrence_key: `${c.date}T${time}`, pet_id: null });
  await paintDetail(c);
  expect(screen.queryByTestId('timer-start')).toBeNull();
  expect(screen.queryByTestId('timer-cancel')).toBeNull();
  expect(c.outbox.count()).toBe(0);
});

test('Q-59 03 section 6 the finished timer remains visible for less than sixty seconds', async () => {
  const c = await scene();
  seedTimer(c, { started_at: new Date(c.clock.now() - 300_000).toISOString(),
    ends_at: new Date(c.clock.now() - 59_000).toISOString() });
  await paintDetail(c);
  expect(screen.getByText(formatDuration(0))).toBeOnTheScreen();
  expect(screen.getByTestId('timer-cancel')).toBeOnTheScreen();
  await act(async () => {
    c.clock.advance(1000);
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(screen.queryByTestId('timer-cancel')).toBeNull();
  expect(screen.getByTestId('timer-start')).toBeEnabled();
});

test.each(['light', 'dark'] as const)('R3.31 Reduce Motion keeps a static %s orbit and ticking text without timing', async (scheme) => {
  const c = await scene();
  const timer = seedTimer(c);
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme, color: scheme === 'light' ? light : dark });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  await render(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  expect(screen.getByText(formatDuration(300))).toBeOnTheScreen();
  await act(async () => {
    c.clock.advance(1000);
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText(formatDuration(299))).toBeOnTheScreen();
  expect(timing).not.toHaveBeenCalled();
});

test('R3.31 losing focus cancels the ring and refocusing derives a fresh animation from the clock', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const view = await render(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  cancel.mockClear();
  await view.rerender(<CountdownRing timer={timer} clock={c.clock} active={false} testID="timer-ring" />);
  expect(cancel).toHaveBeenCalled();
  expect(timing).toHaveBeenCalledTimes(1);
  c.clock.advance(125_000);
  await view.rerender(<CountdownRing timer={timer} clock={c.clock} active testID="timer-ring" />);
  expect(timing).toHaveBeenCalledTimes(2);
  expect(timing.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ duration: 175_000 }));
  expect(screen.getByText(formatDuration(175))).toBeOnTheScreen();
});

test('R3.31 06 section 4.4 expiry fires one foreground haptic and none on an expired mount', async () => {
  const c = await scene();
  const timer = seedTimer(c, { ends_at: new Date(c.clock.now() + 1000).toISOString() });
  const haptic = jest.spyOn(Haptics, 'notificationAsync');
  const view = await render(<CountdownRing timer={timer} clock={c.clock} active />);
  await act(async () => {
    c.clock.advance(1000);
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(haptic).toHaveBeenCalledTimes(1);
  expect(haptic).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  await view.unmount();
  await render(<CountdownRing timer={timer} clock={c.clock} active />);
  expect(haptic).toHaveBeenCalledTimes(1);
});

test('R3.28 09 section 10 remaining text uses the duration formatter for fractional seconds', async () => {
  const c = await scene();
  const timer = seedTimer(c);
  c.clock.advance(125_250);
  await render(<CountdownRing timer={timer} clock={c.clock} active />);
  expect(screen.getByText(formatDuration(174.75))).toBeOnTheScreen();
});
