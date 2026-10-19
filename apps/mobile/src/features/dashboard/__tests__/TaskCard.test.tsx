import { addDays, localDate, type Completion, type TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, StyleSheet, useColorScheme, type ViewStyle } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatCompletionLost, formatTime } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import type { HttpResponse } from '../../../platform/http';
import { selectDayView } from '../../../replica/selectors';
import { ReplicaProvider, useReplica } from '../../../replica/useReplica';
import * as StarBurst from '../../../ui/cosmos/starBurst';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { duration } from '../../../ui/motion/tokens';
import { ToastProvider } from '../../../ui/primitives/Toast';
import { starCheck } from '../../../ui/tokens/cosmos';
import { SyncToastHost } from '../../shell/SyncToastHost';
import { TaskCard } from '../TaskCard';
import { CompletionAttribution } from '../CompletionAttribution';
import { dashboardContext, type DashboardContext } from './support';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);

const timezone = 'America/Sao_Paulo';
const initialAppState = AppState.currentState;
let context: DashboardContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
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

type RenderedNode = ReturnType<typeof screen.getByTestId>;

function contains(root: RenderedNode, target: RenderedNode): boolean {
  return root === target || root.queryAll((node) => node === target).length > 0;
}

function commonContainer(root: RenderedNode, targets: readonly RenderedNode[]): RenderedNode {
  const common = [...new Set([root, ...root.queryAll(() => true)])]
    .filter((node) => targets.every((target) => contains(node, target))).at(-1);
  if (common === undefined) throw new Error('The rendered controls have no common container');
  return common;
}

function branchIndex(root: RenderedNode, target: RenderedNode): number {
  return root.children.findIndex((child) => typeof child !== 'string' && contains(child, target));
}

function styleOf(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten<ViewStyle>(node.props.style) ?? {};
}

describe('09 §3.3 TaskCard visual reference', () => {
  test.each(['pending', 'done'] as const)('%s card keeps avatars left, title over its meta or done line, then time and checkbox in one row', async (state) => {
    const c = await scene();
    const task = c.seedTask({ pet_ids: [c.pet.id], times_of_day: ['08:00'], assigned_to: c.other.id });
    const key = `${c.date}T08:00`;
    if (state === 'done') c.seedCompletion(task, { occurrence_key: key,
      completed_by: c.other.id, completed_at: '2026-10-13T10:12:00Z' });
    await paint(c, task, c.date, key);
    const card = screen.getByTestId(`task-card-${task.id}-${key}`);
    const title = within(card).getByText(task.title);
    const line = within(card).getByText(state === 'done'
      ? strings.dashboard.completedBy(c.other.display_name, '07:12') : c.other.display_name);
    const time = within(card).getByText('08:00');
    const check = screen.getByTestId(checkId(task, key));
    const avatars = card.queryAll((node) => node.props.accessibilityRole === 'image');
    expect(avatars).toHaveLength(1);
    const avatar = avatars[0];
    if (avatar === undefined) throw new Error('The seeded pet avatar is missing');
    const row = commonContainer(card, [avatar, title, time, check]);
    expect(row).toHaveStyle({ flexDirection: 'row', alignItems: 'center' });
    // Check each left-to-right relationship, allowing nested horizontal
    // pressable or trailing groups without accepting the old stacked column.
    for (const [left, right] of [[avatar, title], [title, time], [time, check]] as const) {
      const horizontal = commonContainer(row, [left, right]);
      expect(horizontal).toHaveStyle({ flexDirection: 'row' });
      expect(branchIndex(horizontal, left)).toBeLessThan(branchIndex(horizontal, right));
    }
    const middle = commonContainer(card, [title, line]);
    expect(contains(row, middle)).toBe(true);
    expect(styleOf(middle).flexDirection ?? 'column').toBe('column');
    expect(branchIndex(middle, title)).toBeLessThan(branchIndex(middle, line));
    expect(contains(middle, avatar)).toBe(false);
    expect(contains(middle, time)).toBe(false);
    expect(title).toHaveProp('numberOfLines', 1);
    expect(title).toHaveProp('ellipsizeMode', 'tail');
    expect(c.http.requests).toEqual([]);
  });

  test.each([360, 560])('per_pet toggles stay below the header with two per line at %i dp', async (width) => {
    const c = await scene();
    const pets = [c.pet, ...Array.from({ length: 4 }, (_, index) => c.seedPet({ name: `Pet ${index + 2}` }))];
    const task = c.seedTask({ pet_ids: pets.map((pet) => pet.id), completion_mode: 'per_pet', times_of_day: ['08:00'] });
    const key = `${c.date}T08:00`;
    await paint(c, task, c.date, key);
    const card = screen.getByTestId(`task-card-${task.id}-${key}`);
    const toggles = within(card).getAllByTestId(/^task-pet-/);
    expect(toggles.map((toggle) => toggle.props.testID)).toEqual(pets.map((pet) => petId(task, key, pet.id)));
    expect(screen.queryByTestId(checkId(task, key))).toBeNull();
    const grid = commonContainer(card, toggles);
    await fireEvent(grid, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 240 } } });
    const title = within(card).getByText(task.title);
    const headerAndGrid = commonContainer(card, [title, grid]);
    expect(styleOf(headerAndGrid).flexDirection ?? 'column').toBe('column');
    expect(branchIndex(headerAndGrid, title)).toBeLessThan(branchIndex(headerAndGrid, grid));
    const branches = grid.children.filter((child): child is RenderedNode => typeof child !== 'string'
      && toggles.some((toggle) => contains(child, toggle)));
    if (branches.length === 3) {
      // Explicit pair rows and a wrapping two-column grid are both valid.
      expect(branches.map((branch) => toggles.filter((toggle) => contains(branch, toggle)).length)).toEqual([2, 2, 1]);
      for (const branch of branches) expect(branch).toHaveStyle({ flexDirection: 'row' });
    } else {
      expect(branches).toHaveLength(5);
      expect(grid).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' });
      const gap = Number(styleOf(grid).columnGap ?? styleOf(grid).gap ?? 0);
      const widths = branches.map((branch) => {
        const ownStyle = styleOf(branch);
        const ownWidth = ownStyle.flexBasis ?? ownStyle.width;
        if (typeof ownWidth === 'number') return ownWidth;
        if (typeof ownWidth === 'string' && ownWidth.endsWith('%')) return width * Number.parseFloat(ownWidth) / 100;
        return Math.max(...[branch, ...branch.queryAll(() => true)].map((node) => {
          const style = styleOf(node);
          const value = style.flexBasis ?? style.width;
          return typeof value === 'number' ? value : 0;
        }));
      });
      expect((widths[0] ?? 0) + (widths[1] ?? 0) + gap).toBeLessThanOrEqual(width);
      expect((widths[0] ?? 0) + (widths[1] ?? 0) + (widths[2] ?? 0) + 2 * gap).toBeGreaterThan(width);
    }
    expect(c.outbox.count()).toBe(0);
    expect(c.http.requests).toEqual([]);
  });

  describe.each(['light', 'dark'] as const)('future checkboxes in %s', (scheme) => {
    test.each(['together', 'per_pet'] as const)('%s shows visible disabled checkboxes with rings at 40 percent opacity', async (mode) => {
      jest.mocked(useColorScheme).mockReturnValue(scheme);
      const c = await scene();
      const task = c.seedTask({ pet_ids: [c.pet.id], completion_mode: mode, times_of_day: [] });
      const future = addDays(c.date, 1);
      await paint(c, task, future);
      const id = mode === 'together' ? checkId(task, future) : petId(task, future, c.pet.id);
      const check = screen.getByTestId(id);
      expect(check).toBeVisible();
      expect(check).toBeDisabled();
      await fireEvent(check, 'pressIn');
      await fireEvent.press(check);
      expect(live(c)).toEqual([]);
      expect(c.outbox.count()).toBe(0);
      expect(c.kick).not.toHaveBeenCalled();
      expect(c.http.requests).toEqual([]);
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
      const rings = check.queryAll((node) => styleOf(node).borderWidth === starCheck.strokeWidth
        && styleOf(node).width === starCheck.size && styleOf(node).height === starCheck.size);
      expect(rings).toHaveLength(1);
      const ring = rings[0];
      if (ring === undefined) throw new Error('The visible checkbox ring is missing');
      const opacity = [...new Set([check, ...check.queryAll(() => true)])].filter((node) => contains(node, ring))
        .reduce((alpha, node) => alpha * Number(styleOf(node).opacity ?? 1), 1);
      expect(opacity).toBeCloseTo(0.4);
    });
  });
});

describe('TaskCard', () => {
  test('P5-14 R1/Q-52 per-pet completions seed distinct bursts with the occurrence key and pet id', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
    const generated = jest.spyOn(StarBurst, 'generateStarBurst');
    const c = await scene();
    const second = c.seedPet({ name: 'Second pet' });
    const pets = [c.pet, second];
    const task = c.seedTask({ pet_ids: pets.map((pet) => pet.id), times_of_day: ['08:00'], completion_mode: 'per_pet' });
    const key = `${c.date}T08:00`;
    await paint(c, task, c.date, key);
    const bursts: StarBurst.BurstParticle[][] = [];
    for (const pet of pets) {
      const id = petId(task, key, pet.id);
      const expected = StarBurst.generateStarBurst(key + pet.id);
      generated.mockClear();
      await fireEvent.press(screen.getByTestId(id));
      expect(screen.getByTestId(id)).toBeChecked();
      expect(screen.getByTestId(`${id}-burst`, { includeHiddenElements: true })).toBeOnTheScreen();
      expect(generated).toHaveBeenCalledTimes(1);
      const actual = generated.mock.results[0]?.value as StarBurst.StarBurst | undefined;
      expect(actual?.particles).toEqual(expected.particles);
      if (actual === undefined) throw new Error('The burst particles were not generated');
      bursts.push(actual.particles);
    }
    expect(bursts[0]).not.toEqual(bursts[1]);
    expect(live(c)).toHaveLength(2);
  });

  test('P5-14 R1/Q-52 a together completion seeds its burst with the occurrence key', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
    const generated = jest.spyOn(StarBurst, 'generateStarBurst');
    const c = await scene();
    const task = c.seedTask({ pet_ids: [c.pet.id], times_of_day: ['08:00'], completion_mode: 'together' });
    const key = `${c.date}T08:00`;
    await paint(c, task, c.date, key);
    const id = checkId(task, key);
    const expected = StarBurst.generateStarBurst(key);
    generated.mockClear();
    await fireEvent.press(screen.getByTestId(id));
    expect(screen.getByTestId(id)).toBeChecked();
    expect(screen.getByTestId(`${id}-burst`, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(generated).toHaveBeenCalledTimes(1);
    expect(generated.mock.results).toEqual([{ type: 'return', value: expected }]);
    expect(onlyCompletion(c).occurrence_key).toBe(key);
  });

  test('R3.44 release without photo proof leaves no completion or outbox entry and keeps the star unlit', async () => {
    const c = await scene();
    const task = c.seedTask({ pet_ids: [c.pet.id], times_of_day: [], requires_photo: true });
    const { onMoveToDone } = await paint(c, task);
    const check = screen.getByTestId(checkId(task, c.date));
    expect(check).toBeEnabled();
    expect(check).not.toBeChecked();
    await fireEvent(check, 'pressIn');
    await fireEvent.press(check);
    await advance(c, 400);
    expect(Object.values(c.store.getState().completions)).toEqual([]);
    expect(c.replica.range('task_completions', c.date, c.date)).toEqual([]);
    expect(c.outbox.count()).toBe(0);
    expect(screen.getByTestId(checkId(task, c.date))).not.toBeChecked();
    expect(c.kick).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onMoveToDone).not.toHaveBeenCalled();
  });

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

describe('CompletionAttribution', () => {
  test.each([false, true])('R3.21 / 06 §4.2 crossfades to the winning member and retains the outgoing label until the fade ends with Reduce Motion %s', async (reduced) => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(reduced);
    const c = await scene();
    const local = c.seedCompletion(c.task, { occurrence_key: c.date, completed_by: c.sessionUser.id,
      completed_at: new Date(c.clock.now()).toISOString() });
    const winner = c.factory.task_completions({ task_id: c.task.id, occurrence_key: c.date,
      completed_by: c.other.id, completed_at: '2026-10-13T10:12:00Z' });
    const member = c.store.getState().members[c.sessionUser.id];
    if (member === undefined) throw new Error('The seeded member is missing');
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    const view = await render(<CompletionAttribution completion={local} member={member} timezone={timezone} active />);
    const outgoingLabel = strings.dashboard.completedBy(member.display_name, formatTime(c.clock.now(), timezone));
    const incomingLabel = strings.dashboard.completedBy(c.other.display_name, '07:12');
    expect(screen.getByText(outgoingLabel)).toBeVisible();
    expect(timing).not.toHaveBeenCalled();

    await view.rerender(<CompletionAttribution completion={winner} member={c.other} timezone={timezone} active />);
    await advance(c, 0);
    const outgoing = screen.getByText(outgoingLabel, { includeHiddenElements: true }).parent;
    const incoming = screen.getByText(incomingLabel).parent;
    if (outgoing === null || incoming === null) throw new Error('The attribution fade layers are missing');
    const milliseconds = reduced ? duration.reducedFade : duration.quick;
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(1, { duration: milliseconds });
    expect(outgoing).toHaveAnimatedStyle({ opacity: 1 });
    expect(incoming).toHaveAnimatedStyle({ opacity: 0 });

    await advance(c, milliseconds / 2);
    expect(within(outgoing).getByText(outgoingLabel, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(Number(getAnimatedStyle(outgoing).opacity)).toBeGreaterThan(0);
    expect(Number(getAnimatedStyle(outgoing).opacity)).toBeLessThan(1);
    expect(Number(getAnimatedStyle(incoming).opacity)).toBeGreaterThan(0);
    expect(Number(getAnimatedStyle(incoming).opacity)).toBeLessThan(1);
    await advance(c, milliseconds / 2 + 32);
    expect(outgoing).toHaveAnimatedStyle({ opacity: 0 });
    expect(incoming).toHaveAnimatedStyle({ opacity: 1 });
    expect(screen.getByText(incomingLabel)).toBeVisible();
    expect(screen.queryByText(outgoingLabel)).toBeNull();
    expect(c.http.requests).toEqual([]);
  });
});
