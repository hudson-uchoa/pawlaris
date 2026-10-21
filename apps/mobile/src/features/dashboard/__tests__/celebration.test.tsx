import { addDays, localDate, type TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, useColorScheme } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { strings } from '../../../i18n/strings';
import { hydrateReplica } from '../../../replica/apply';
import { selectDayView } from '../../../replica/selectors';
import { createReplicaStore, type ReplicaStore } from '../../../replica/store';
import { ReplicaProvider } from '../../../replica/useReplica';
import { atlasAlphas } from '../../../ui/cosmos/__tests__/skyDrawing';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { DashboardScreen } from '../DashboardScreen';
import { dashboardContext, type DashboardContext } from './support';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
type RenderedView = Awaited<ReturnType<typeof render>>;
const initialAppState = AppState.currentState;
let context: DashboardContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  const requests = context?.http.requests ?? [];
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
  expect(requests).toEqual([]);
});

async function scene() {
  const c = await dashboardContext();
  context = c;
  return c;
}

function today(c: DashboardContext): string {
  return localDate(c.clock.now(), 'America/Sao_Paulo');
}

function tree(c: DashboardContext, store: ReplicaStore = c.store, preferences = c.kv, initialDate?: string, active = true) {
  return <ReplicaProvider store={store}><AssetFilesProvider files={c.files}>
    <DashboardScreen services={{ ...c.services, preferences }} active={active} onAdd={c.onAdd}
      onManage={c.onManage} onOpenPet={c.onOpenPet}
      {...(initialDate === undefined ? {} : { initialDate })} />
  </AssetFilesProvider></ReplicaProvider>;
}

function dayView(c: DashboardContext, date = today(c), scope: 'mine' | 'all' = 'mine') {
  return selectDayView(c.store.getState(), { date, now: c.clock.now(), me: c.sessionUser.id, scope });
}

function task(c: DashboardContext, overrides: Partial<TaskTemplate> = {}) {
  const pet = c.seedPet();
  return c.seedTask({ pet_ids: [pet.id], times_of_day: [], recurrence: { freq: 'daily', interval: 1 }, ...overrides });
}

async function complete(c: DashboardContext, template: TaskTemplate, date = today(c), petId: string | null = null) {
  let id = '';
  await act(() => {
    id = c.mutations.createCompletion({ task_id: template.id, occurrence_key: date,
      pet_id: petId, completed_at: new Date(c.clock.now()).toISOString(), photo_asset_id: null, note: null });
  });
  return id;
}

async function advance(milliseconds: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

function headerCanvas(view: RenderedView) {
  const background = view.getByTestId('dashboard').children[0];
  if (background === undefined || typeof background === 'string') throw new Error('Missing dashboard sky header');
  const canvas = background.children[0];
  if (canvas === undefined || typeof canvas === 'string') throw new Error('Missing dashboard sky canvas');
  return canvas;
}

function meteors(view: RenderedView) {
  // Celebration tails are 60 dp; ambient meteors have shared-value endpoints
  // and 80-140 dp tails (06 sections 4.1 and 4.5).
  return headerCanvas(view).queryAll((node) => {
    if (node.type !== 'skLine') return false;
    const start = node.props.p1 as { x?: number; y?: number };
    const end = node.props.p2 as { x?: number; y?: number };
    return typeof start.x === 'number' && typeof start.y === 'number'
      && typeof end.x === 'number' && typeof end.y === 'number'
      && Math.abs(Math.hypot(end.x - start.x, end.y - start.y) - 60) < 0.000001;
  });
}

function particles(view: RenderedView) {
  return headerCanvas(view).queryAll((node) =>
    (node.type === 'skCircle' || node.type === 'skPath') && node.props.style !== 'stroke');
}

function rings(view: RenderedView) {
  return headerCanvas(view).queryAll((node) => node.type === 'skCircle' && node.props.style === 'stroke');
}

function header() {
  expect(screen.getByRole('header', { name: strings.dashboard.completeSky })).toBeOnTheScreen();
}

function celebrationStarts(timing: jest.SpiedFunction<AnimationAPI['withTiming']>) {
  return timing.mock.calls.filter(([target, config]) => target === 1600
    && (config as { duration?: number } | undefined)?.duration === 1600);
}

test('R6.13 / 06 §4.5 plays when allDone turns true today in the viewer scope', async () => {
  const c = await scene();
  // UTC has reached October 14; the injected clock says October 13 for the family.
  expect(new Date(c.clock.now()).toISOString().slice(0, 10)).toBe('2026-10-14');
  expect(today(c)).toBe('2026-10-13');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(tree(c));
  expect(dayView(c).allDone).toBe(false);
  expect(c.kv.get('celebrated_on')).toBeNull();
  expect(meteors(view)).toHaveLength(0);
  expect(screen.queryByRole('header', { name: strings.dashboard.completeSky })).toBeNull();

  let scheduled: TaskTemplate | undefined;
  await act(() => {
    const first = c.seedPet();
    const second = c.seedPet();
    scheduled = c.seedTask({ pet_ids: [first.id, second.id], completion_mode: 'per_pet',
      times_of_day: [], assigned_to: c.sessionUser.id, recurrence: { freq: 'daily', interval: 1 } });
    task(c, { assigned_to: c.other.id });
  });
  if (scheduled === undefined) throw new Error('The seeded task is missing');
  await complete(c, scheduled, today(c), scheduled.pet_ids[0] ?? null);
  expect(dayView(c).allDone).toBe(false);
  expect(meteors(view)).toHaveLength(0);
  expect(c.kv.get('celebrated_on')).toBeNull();
  const ordinaryParticles = particles(view).length;
  const ordinaryRings = rings(view).length;
  await complete(c, scheduled, today(c), scheduled.pet_ids[1] ?? null);
  expect(dayView(c).allDone).toBe(true);
  expect(dayView(c, today(c), 'all').allDone).toBe(false);

  expect(celebrationStarts(timing)).toHaveLength(1);
  expect(meteors(view)).toHaveLength(5);
  // Forty supernova particles and five meteor heads join the same canvas.
  expect(particles(view)).toHaveLength(ordinaryParticles + 40 + 5);
  expect(rings(view)).toHaveLength(ordinaryRings + 2);
  header();
  expect(c.kv.get('celebrated_on')).toBe(today(c));
  await advance(250);
  expect(atlasAlphas(view).every((alpha) => alpha === 1)).toBe(true);
  await advance(1450);
  expect(atlasAlphas(view).some((alpha) => alpha < 1)).toBe(true);
});

test('R6.13 waits for focus before spending the day', async () => {
  const c = await scene();
  const scheduled = task(c);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(tree(c, c.store, c.kv, undefined, false));
  expect(dayView(c).allDone).toBe(false);
  expect(c.kv.get('celebrated_on')).toBeNull();

  await complete(c, scheduled);
  expect(dayView(c).allDone).toBe(true);
  expect(c.kv.get('celebrated_on')).toBeNull();
  expect(celebrationStarts(timing)).toHaveLength(0);

  await view.rerender(tree(c));
  expect(celebrationStarts(timing)).toHaveLength(1);
  expect(c.kv.get('celebrated_on')).toBe(today(c));
});

test('R6.13 does not play twice in a day after undo, scope changes or a replica rebuild (kv.celebrated_on)', async () => {
  const c = await scene();
  const scheduled = task(c);
  task(c, { assigned_to: c.other.id });
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(tree(c));
  const completion = await complete(c, scheduled);
  expect(celebrationStarts(timing)).toHaveLength(1);
  expect(c.kv.get('celebrated_on')).toBe(today(c));
  await advance(1700);
  await act(() => { c.mutations.undoCompletion(completion); });
  expect(dayView(c).allDone).toBe(false);
  await complete(c, scheduled);
  expect(dayView(c).allDone).toBe(true);
  await fireEvent.press(screen.getByTestId('scope-all'));
  await fireEvent.press(screen.getByTestId('scope-mine'));
  await advance(1700);
  expect(celebrationStarts(timing)).toHaveLength(1);
  header();
  await view.unmount();

  const rebuilt = createReplicaStore();
  hydrateReplica({ driver: c.driver, store: rebuilt, clock: c.clock });
  const preferences = c.kv;
  const reopened = await render(tree(c, rebuilt, preferences));
  await advance(1700);
  expect(celebrationStarts(timing)).toHaveLength(1);
  header();
  expect(preferences.get('celebrated_on')).toBe(today(c));

  // The persistent gate is per family-local day, not a permanent consumed flag.
  await reopened.unmount();
  c.clock.advance(24 * 60 * 60_000);
  await render(tree(c));
  await complete(c, scheduled);
  expect(celebrationStarts(timing)).toHaveLength(2);
  expect(preferences.get('celebrated_on')).toBe(today(c));
  header();
});

test('R6.13 does not celebrate another day view or consume today until returning to it', async () => {
  const c = await scene();
  const scheduled = task(c);
  const yesterday = addDays(today(c), -1);
  c.seedCompletion(scheduled, { occurrence_key: yesterday });
  c.kv.set('celebrated_on', addDays(today(c), -2));
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const view = await render(tree(c, c.store, c.kv, yesterday));
  expect(dayView(c, yesterday).allDone).toBe(true);
  expect(celebrationStarts(timing)).toHaveLength(0);
  expect(meteors(view)).toHaveLength(0);
  expect(screen.queryByRole('header', { name: strings.dashboard.completeSky })).toBeNull();
  await complete(c, scheduled);
  expect(dayView(c).allDone).toBe(true);
  expect(celebrationStarts(timing)).toHaveLength(0);
  expect(c.kv.get('celebrated_on')).toBe(addDays(today(c), -2));
  await fireEvent.press(screen.getByTestId('day-today'));
  expect(celebrationStarts(timing)).toHaveLength(1);
  expect(c.kv.get('celebrated_on')).toBe(today(c));
  header();
  await fireEvent.press(screen.getByTestId('day-next'));
  expect(celebrationStarts(timing)).toHaveLength(1);
  expect(meteors(view)).toHaveLength(0);
  expect(screen.queryByRole('header', { name: strings.dashboard.completeSky })).toBeNull();
});

test.each(['light', 'dark'] as const)('R6.13 / 06 §5 / MO-3 Reduce Motion shows the still bright %s fallback', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const spring = jest.spyOn(springAnimation, 'withSpring');
  const c = await scene();
  const scheduled = task(c);
  const view = await render(tree(c));
  const ordinary = atlasAlphas(view);
  const ordinaryParticles = particles(view).length;
  const ordinaryRings = rings(view).length;
  expect(ordinary.length).toBeGreaterThan(0);
  expect(ordinary.some((alpha) => alpha < 1)).toBe(true);
  await complete(c, scheduled);
  expect(dayView(c).allDone).toBe(true);
  await advance(0);
  expect(atlasAlphas(view)).toEqual(ordinary.map(() => 1));
  header();
  expect(c.kv.get('celebrated_on')).toBe(today(c));
  expect(meteors(view)).toHaveLength(0);
  expect(particles(view)).toHaveLength(ordinaryParticles);
  expect(rings(view)).toHaveLength(ordinaryRings);
  expect(repeat).not.toHaveBeenCalled();
  expect(spring).not.toHaveBeenCalled();
  expect(timing.mock.calls.every(([, config]) => config?.duration === 0)).toBe(true);
  const transforms = view.container.queryAll((node) => node.type === 'skAtlas')
    .map((node) => (node.props.transforms as SharedValue<unknown>).get());
  await advance(800);
  expect(atlasAlphas(view)).toEqual(ordinary.map(() => 1));
  expect(view.container.queryAll((node) => node.type === 'skAtlas')
    .map((node) => (node.props.transforms as SharedValue<unknown>).get())).toEqual(transforms);
  await advance(900);
  expect(atlasAlphas(view)).toEqual(ordinary);
});
