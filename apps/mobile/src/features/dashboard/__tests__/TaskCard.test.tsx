import { addDays, localDate, type Completion, type TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatCompletionLost, formatTime } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import type { HttpResponse } from '../../../platform/http';
import { selectDayView } from '../../../replica/selectors';
import { ReplicaProvider, useReplica } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { ToastProvider } from '../../../ui/primitives/Toast';
import { SyncToastHost } from '../../shell/SyncToastHost';
import { TaskCard } from '../TaskCard';
import { dashboardContext, type DashboardContext } from './support';

const timezone = 'America/Sao_Paulo';
const initialAppState = AppState.currentState;
let context: DashboardContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene(role: Parameters<typeof dashboardContext>[0] = 'leader') {
  const c = await dashboardContext(role);
  context = c;
  // taskContext advances the clock beyond the original test session's expiry.
  await c.session.adopt({ access_token: 'fake-test-access', refresh_token: 'fake-test-refresh',
    access_expires_at: new Date(c.clock.now() + 900_000).toISOString(), user: c.sessionUser });
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const date = localDate(c.clock.now(), timezone);
  return { ...c, pet, task, date };
}

type Scene = Awaited<ReturnType<typeof scene>>;

function checkId(task: TaskTemplate, key: string): string {
  return `task-check-${task.id}-${key}`;
}

function petId(task: TaskTemplate, key: string, id: string): string {
  return `task-pet-${task.id}-${key}-${id}`;
}

// Keep the real day-view selector and subscription: mutation acknowledgements
// must update the rendered card without a test manually supplying a new item.
function ReplicaCard({ c, task, date, occurrenceKey, onMoveToDone }: {
  c: Scene;
  task: TaskTemplate;
  date: string;
  occurrenceKey: string;
  onMoveToDone: () => void;
}) {
  const members = useReplica((state) => state.members);
  const item = useReplica((state) => {
    const view = selectDayView(state, { date, now: c.clock.now(), me: c.sessionUser.id, scope: 'all' });
    return [...view.overdue, ...view.now, ...view.later, ...view.done]
      .find((row) => row.taskId === task.id && row.occurrenceKey === occurrenceKey);
  });
  if (item === undefined) throw new Error('The seeded occurrence is missing');
  return <TaskCard item={item} members={members} viewerId={c.sessionUser.id}
    date={date} timezone={timezone} active services={{ clock: c.clock, mutations: c.mutations }}
    onMoveToDone={onMoveToDone} />;
}

async function paint(c: Scene, task = c.task, date = c.date, occurrenceKey = date) {
  const onMoveToDone = jest.fn();
  await render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>
      <ToastProvider dismissLabel={strings.dismiss}>
        <ReplicaCard c={c} task={task} date={date} occurrenceKey={occurrenceKey} onMoveToDone={onMoveToDone} />
        <SyncToastHost events={c.events} active />
      </ToastProvider>
    </AssetFilesProvider>
  </ReplicaProvider>);
  return { onMoveToDone };
}

function live(c: Scene): Completion[] {
  return Object.values(c.store.getState().completions).filter((row) => row.undone_at === null);
}

function onlyCompletion(c: Scene): Completion {
  expect(live(c)).toHaveLength(1);
  const row = live(c)[0];
  if (row === undefined) throw new Error('The completion was not created');
  return row;
}

async function advance(c: Scene, milliseconds: number): Promise<void> {
  c.clock.advance(milliseconds);
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

describe('TaskCard', () => {
  test('R3.18 does not complete on press-in', async () => {
    const c = await scene();
    const { onMoveToDone } = await paint(c);
    const check = screen.getByTestId(checkId(c.task, c.date));
    expect(check).not.toBeChecked();
    await fireEvent(check, 'pressIn');
    expect(screen.getByTestId(checkId(c.task, c.date))).not.toBeChecked();
    expect(live(c)).toEqual([]);
    expect(c.outbox.count()).toBe(0);
    expect(c.kick).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onMoveToDone).not.toHaveBeenCalled();
  });

  test('R3.18 / 06 §4.2 completes on release before any request resolves and moves after 400 ms', async () => {
    const c = await scene();
    let finish: ((response: HttpResponse) => void) | undefined;
    const pending = new Promise<HttpResponse>((resolve) => { finish = resolve; });
    c.http.enqueue(() => pending);
    const { onMoveToDone } = await paint(c);
    await fireEvent(screen.getByTestId(checkId(c.task, c.date)), 'pressIn');
    await fireEvent.press(screen.getByTestId(checkId(c.task, c.date)));
    const row = onlyCompletion(c);
    expect(row).toMatchObject({ task_id: c.task.id, occurrence_key: c.date, pet_id: null,
      completed_by: c.sessionUser.id, completed_at: new Date(c.clock.now()).toISOString(),
      title_snapshot: c.task.title, undone_at: null });
    expect(c.replica.get('task_completions', row.id)?.row).toEqual(row);
    expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ entityId: row.id, path: '/completions' });
    expect(c.outbox.count()).toBe(1);
    expect(c.kick).toHaveBeenCalledWith('mutation');
    expect(c.http.requests).toEqual([]);
    expect(screen.getByTestId(checkId(c.task, c.date))).toBeChecked();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);

    let resolved = false;
    const draining = c.drain.drain().then((result) => { resolved = true; return result; });
    await act(async () => { await Promise.resolve(); });
    expect(c.http.requests).toHaveLength(1);
    expect(resolved).toBe(false);
    expect(screen.getByTestId(checkId(c.task, c.date))).toBeChecked();
    expect(onMoveToDone).not.toHaveBeenCalled();
    await advance(c, 399);
    expect(onMoveToDone).not.toHaveBeenCalled();
    await advance(c, 1);
    expect(onMoveToDone).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    await act(async () => {
      finish?.({ status: 200, headers: {}, body: { ...row, revision: 2 } });
      expect(await draining).toBe('empty');
    });
    expect(onMoveToDone).toHaveBeenCalledTimes(1);
  });

  test('R3.18 does not complete when the press is cancelled by a scroll', async () => {
    const c = await scene();
    const { onMoveToDone } = await paint(c);
    const check = screen.getByTestId(checkId(c.task, c.date));
    await fireEvent(check, 'pressIn');
    // A scroll terminates Pressability: pressOut occurs without onPress.
    await fireEvent(check, 'pressOut');
    await advance(c, 1000);
    expect(screen.getByTestId(checkId(c.task, c.date))).not.toBeChecked();
    expect(live(c)).toEqual([]);
    expect(c.outbox.count()).toBe(0);
    expect(c.kick).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onMoveToDone).not.toHaveBeenCalled();
  });

  test('R3.21 stays lit and shows the winner when it loses the race', async () => {
    const c = await scene();
    await paint(c);
    await fireEvent.press(screen.getByTestId(checkId(c.task, c.date)));
    const local = onlyCompletion(c);
    const winner = c.factory.task_completions({ task_id: c.task.id, occurrence_key: c.date,
      completed_by: c.other.id, completed_at: '2026-10-13T10:12:00Z', title_snapshot: c.task.title });
    const lost = jest.fn();
    const unsubscribe = c.events.on('completion_lost', lost);
    const checkedStates: boolean[] = [];
    const unsubscribeStore = c.store.subscribe((state) => {
      const view = selectDayView(state, { date: c.date, now: c.clock.now(), me: c.sessionUser.id, scope: 'all' });
      checkedStates.push(view.done.some((item) => item.taskId === c.task.id && item.occurrenceKey === c.date));
    });
    c.http.enqueue({ status: 200, headers: {}, body: winner });
    await act(async () => { expect(await c.drain.drain()).toBe('empty'); });
    unsubscribeStore();
    unsubscribe();
    expect(checkedStates.length).toBeGreaterThan(0);
    expect(checkedStates.every(Boolean)).toBe(true);
    expect(screen.getByTestId(checkId(c.task, c.date))).toBeChecked();
    const card = screen.getByTestId(`task-card-${c.task.id}-${c.date}`);
    expect(within(card).getByText(`${c.other.display_name} · 07:12`)).toBeOnTheScreen();
    expect(within(card).queryByText(`${c.sessionUser.display_name} · ${formatTime(c.clock.now(), timezone)}`)).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      formatCompletionLost(c.other.display_name, Date.parse(winner.completed_at), timezone));
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledWith({ winner });
    expect(c.store.getState().completions[local.id]).toBeUndefined();
    expect(live(c)).toEqual([winner]);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    await act(async () => { expect(await c.drain.drain()).toBe('empty'); });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  test('R3.18 / R3.21 never puts the star out on a network failure', async () => {
    const c = await scene();
    await paint(c);
    await fireEvent.press(screen.getByTestId(checkId(c.task, c.date)));
    const row = onlyCompletion(c);
    c.http.enqueue(new Error('Simulated offline transport'));
    await act(async () => { expect(await c.drain.drain()).toBe('waiting'); });
    await advance(c, 1000);
    expect(c.http.requests).toHaveLength(1);
    expect(screen.getByTestId(checkId(c.task, c.date))).toBeChecked();
    expect(live(c)).toEqual([row]);
    expect(c.outbox.count()).toBe(1);
    expect(c.outbox.head(c.sessionUser.id)?.attempts).toBe(1);
    expect(c.deadLetter.count()).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  test('R3.4 / R6.7 renders 2/4 and four pet toggles in per_pet mode with no master checkbox', async () => {
    const c = await scene();
    const pets = [c.pet, ...Array.from({ length: 3 }, (_, index) => c.seedPet({ name: `Pet ${index + 2}` }))];
    const task = c.seedTask({ pet_ids: pets.map((pet) => pet.id), times_of_day: [], completion_mode: 'per_pet' });
    for (const pet of pets.slice(0, 2)) c.seedCompletion(task, {
      occurrence_key: c.date, pet_id: pet.id, completed_by: c.other.id, completed_at: '2026-10-13T10:12:00Z',
    });
    await paint(c, task);
    expect(screen.getByText('2/4')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^task-pet-/)).toHaveLength(4);
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.queryByTestId(checkId(task, c.date))).toBeNull();
    for (const [index, pet] of pets.entries()) {
      const toggle = screen.getByTestId(petId(task, c.date, pet.id));
      expect(within(toggle).getByText(pet.name)).toBeOnTheScreen();
      if (index < 2) {
        expect(toggle).toBeChecked();
        expect(within(toggle).getByText(`${c.other.display_name} · 07:12`)).toBeOnTheScreen();
      } else expect(toggle).not.toBeChecked();
    }
    expect(c.outbox.count()).toBe(0);
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  test('06 §4.3 draws the constellation line when the last pet is completed', async () => {
    const c = await scene();
    const second = c.seedPet({ name: 'Second pet' });
    const task = c.seedTask({ pet_ids: [c.pet.id, second.id], times_of_day: [], completion_mode: 'per_pet' });
    c.seedCompletion(task, { occurrence_key: c.date, pet_id: c.pet.id, completed_by: c.other.id });
    const { onMoveToDone } = await paint(c, task);
    const lineId = `task-constellation-${task.id}-${c.date}`;
    expect(screen.getByText('1/2')).toBeOnTheScreen();
    expect(screen.queryByTestId(lineId, { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(screen.getByTestId(petId(task, c.date, second.id)));
    expect(screen.getByText('2/2')).toBeOnTheScreen();
    expect(screen.getByTestId(petId(task, c.date, second.id))).toBeChecked();
    expect(screen.getByTestId(lineId, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(live(c)).toHaveLength(2);
    expect(live(c).find((row) => row.pet_id === second.id)).toMatchObject({
      task_id: task.id, occurrence_key: c.date, completed_by: c.sessionUser.id,
    });
    expect(c.outbox.count()).toBe(1);
    expect(onMoveToDone).not.toHaveBeenCalled();
    await advance(c, 400);
    expect(onMoveToDone).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(lineId, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(c.http.requests).toEqual([]);
  });

  test('R3.22 asks for confirmation before undoing naming who and when', async () => {
    const c = await scene('member');
    const row = c.seedCompletion(c.task, { occurrence_key: c.date, completed_by: c.other.id,
      completed_at: '2026-10-13T10:12:00Z' });
    await paint(c);
    await fireEvent.press(screen.getByTestId(checkId(c.task, c.date)));
    expect(within(screen.getByRole('dialog')).getByText(
      strings.dashboard.undoBody(c.other.display_name, '07:12'),
    )).toBeOnTheScreen();
    expect(c.store.getState().completions[row.id]?.undone_at).toBeNull();
    expect(c.outbox.count()).toBe(0);
    // Android back dismisses the real Sheet without confirming an undo.
    await fireEvent(screen.getByTestId('undo-sheet-modal'), 'requestClose');
    await advance(c, 300);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId(checkId(c.task, c.date))).toBeChecked();
    expect(c.outbox.count()).toBe(0);
    await fireEvent.press(screen.getByTestId(checkId(c.task, c.date)));
    await fireEvent.press(screen.getByTestId('undo-confirm'));
    expect(c.store.getState().completions[row.id]).toMatchObject({ ...row,
      updated_at: new Date(c.clock.now()).toISOString(),
      undone_at: new Date(c.clock.now()).toISOString(), undone_by: c.sessionUser.id });
    expect(c.replica.get('task_completions', row.id)?.row.undone_by).toBe(c.sessionUser.id);
    expect(c.outbox.count()).toBe(1);
    expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ entityId: row.id,
      path: `/completions/${row.id}/undo`, method: 'POST' });
    expect(screen.getByTestId(checkId(c.task, c.date))).not.toBeChecked();
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  test('R3.26 disables the checkbox on a future day', async () => {
    const c = await scene();
    const future = addDays(c.date, 1);
    await paint(c, c.task, future);
    const check = screen.getByTestId(checkId(c.task, future));
    expect(check).toBeDisabled();
    await fireEvent(check, 'pressIn');
    await fireEvent.press(check);
    expect(live(c)).toEqual([]);
    expect(c.outbox.count()).toBe(0);
    expect(c.kick).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  test('R6.15 shows an orphan completion as done with its stored title', async () => {
    const c = await scene();
    const task = c.seedTask({ title: 'Rescheduled task', pet_ids: [c.pet.id],
      ends_on: addDays(c.date, -1), times_of_day: ['09:00'] });
    const key = `${c.date}T08:00`;
    const row = c.seedCompletion(task, { occurrence_key: key, title_snapshot: 'Original dose title',
      completed_by: c.other.id, completed_at: '2026-10-13T10:12:00Z' });
    const view = selectDayView(c.store.getState(), {
      date: c.date, now: c.clock.now(), me: c.sessionUser.id, scope: 'all',
    });
    expect(view.done).toEqual([expect.objectContaining({ taskId: task.id, occurrenceKey: key, orphan: true })]);
    await paint(c, task, c.date, key);
    const card = screen.getByTestId(`task-card-${task.id}-${key}`);
    expect(within(card).getByText(row.title_snapshot)).toBeOnTheScreen();
    expect(within(card).queryByText(task.title)).toBeNull();
    expect(within(card).getByText(`${c.other.display_name} · 07:12`)).toBeOnTheScreen();
    expect(screen.getByTestId(checkId(task, key))).toBeChecked();
    expect(live(c)).toEqual([row]);
    expect(c.outbox.count()).toBe(0);
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
