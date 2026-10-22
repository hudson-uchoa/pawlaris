import type { SkColor } from '@shopify/react-native-skia';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AppState, useColorScheme } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../assets/useAssetFile';
import { dashboardContext } from '../../features/dashboard/__tests__/support';
import { DashboardScreen } from '../../features/dashboard/DashboardScreen';
import { petContext } from '../../features/pets/__tests__/support';
import { PetProfileScreen } from '../../features/pets/PetProfileScreen';
import { PetsGridScreen } from '../../features/pets/PetsGridScreen';
import { WalksScreen } from '../../features/walks/WalksScreen';
import { strings } from '../../i18n/strings';
import { ReplicaProvider } from '../../replica/useReplica';
import { historyContext } from '../../walks/__tests__/historySupport';
import { crescentPath, starPath } from '../cosmos/glyphs';
import { HeroProvider } from '../motion/hero';
import * as ReduceMotion from '../motion/useReduceMotion';
import { dark, light } from '../tokens/color';
import { illustrations } from '../tokens/cosmos';
import { advance, animationUtil, repeatAnimation } from './motionAuditSupport';
import { accessibilityProblems, targetProblems, themeProblems } from './themeAccessibilitySupport';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type Scene = {
  tree(active: boolean): ReactElement;
  dispose(): void;
  requests(): unknown[];
  action: jest.Mock;
};
type EmptyCase = {
  name: string;
  copy: string;
  actionCopy: string;
  animated: boolean;
  atlasIndex: number;
  shapes: readonly string[];
  paths: readonly string[];
  prepare(): Promise<Scene>;
};
type RenderedView = Awaited<ReturnType<typeof render>>;
const initialAppState = AppState.currentState;
let current: Scene | undefined;
const noop = () => {};
const cases: EmptyCase[] = [
  { name: 'dashboard crescent', copy: strings.dashboard.emptyTitle, actionCopy: strings.dashboard.createTask,
    animated: false, atlasIndex: 1, shapes: ['skPath', 'skPath', 'skPath', 'skPath'],
    paths: [crescentPath(illustrations.clearSky.crescent.x, illustrations.clearSky.crescent.y,
      illustrations.clearSky.crescent.radius), ...illustrations.clearSky.stars.map((star) => starPath(star.x, star.y, star.radius))],
    async prepare() {
      const c = await dashboardContext();
      return { dispose: c.dispose, requests: () => c.http.requests, action: c.onAdd,
        tree: (active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
          <DashboardScreen services={c.services} active={active} onAdd={c.onAdd}
            onManage={c.onManage} onOpenPet={c.onOpenPet} />
        </AssetFilesProvider></ReplicaProvider> };
    } },
  { name: 'pets unlit paw', copy: strings.pets.emptyTitle, actionCopy: strings.pets.addPet,
    animated: true, atlasIndex: 0, shapes: ['skPath', 'skCircle', 'skCircle', 'skCircle', 'skCircle'],
    paths: [illustrations.emptyPets.pad],
    async prepare() {
      const c = await petContext();
      return { dispose: c.dispose, requests: () => c.http.requests, action: c.onAdd,
        tree: (active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
          <HeroProvider active={active}><PetsGridScreen services={c.services} active={active}
            onAdd={c.onAdd} onOpenPet={c.onOpenPet} /></HeroProvider>
        </AssetFilesProvider></ReplicaProvider> };
    } },
  { name: 'walks ringed planet', copy: strings.walks.emptyTitle, actionCopy: strings.walks.startWithDog('Katarina'),
    animated: true, atlasIndex: 0, shapes: ['skOval', 'skPath', 'skCircle', 'skCircle', 'skPath'],
    paths: [illustrations.emptyWalks.back, illustrations.emptyWalks.front],
    async prepare() {
      const c = await historyContext();
      c.seedPet({ name: 'Katarina', species: 'dog' });
      return { dispose: c.dispose, requests: () => c.http.requests, action: c.onStart,
        tree: (active) => <ReplicaProvider store={c.store}>
          <WalksScreen services={c.services} active={active} locationState="granted"
            onStart={c.onStart} onResume={c.onResume} onOpenWalk={c.onOpenWalk}
            onRequestLocation={c.onRequestLocation} onOpenSettings={c.onOpenSettings} />
        </ReplicaProvider> };
    } },
  { name: 'health star and horizon', copy: strings.health.emptyTitle, actionCopy: strings.health.add,
    animated: false, atlasIndex: 1, shapes: ['skPath', 'skLine'],
    paths: [starPath(illustrations.emptyHealth.star.x, illustrations.emptyHealth.star.y, illustrations.emptyHealth.star.radius)],
    async prepare() {
      const c = await petContext();
      const pet = c.seedPet();
      return { dispose: c.dispose, requests: () => c.http.requests, action: c.onAdd,
        tree: (active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
          <HeroProvider active={active}><PetProfileScreen services={c.services} petId={pet.id} active={active}
            onEdit={noop} onAddWeight={noop} onAddHealth={c.onAdd} onOpenHealth={noop} onWalks={noop} />
          </HeroProvider>
        </AssetFilesProvider></ReplicaProvider> };
    } },
];

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden'));
});

afterEach(async () => {
  await cleanup();
  const requests = current?.requests();
  current?.dispose();
  current = undefined;
  expect(requests ?? []).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

function skyAlphas(view: RenderedView): number[][] {
  return view.container.queryAll((node) => node.type === 'skAtlas').map((atlas) =>
    (atlas.props.colors as SharedValue<SkColor[]>).get().map((color) => color[3] ?? 0));
}

describe.each(cases)('P7-3 06 §4.10 $name', (entry) => {
  test.each(['light', 'dark'] as const)('%s scene, exact copy, action and focus lifecycle', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    current = await entry.prepare();
    const view = await render(current.tree(true));
    await advance(0);
    expect(view.getByText(entry.copy)).toBeOnTheScreen();
    const groups = view.container.queryAll((node) => node.type === 'skGroup'
      && Array.isArray(node.props.transform) && node.props.transform.length === 3);
    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (group === undefined) throw new Error('Missing empty-state scene');
    const shapes = group.queryAll((node) => ['skPath', 'skCircle', 'skOval', 'skLine'].includes(node.type));
    expect(shapes.map((shape) => shape.type)).toEqual(entry.shapes);
    expect(shapes.filter((shape) => shape.type === 'skPath').map((shape) => shape.props.path)).toEqual(entry.paths);
    const color = scheme === 'light' ? light : dark;
    for (const shape of shapes) expect(Object.values(color)).toContain(shape.props.color);
    if (entry.name === 'pets unlit paw') {
      for (const shape of shapes) {
        expect(shape.props.color).toBe(color.textMuted);
        const effect = shape.children[0];
        if (effect === undefined || typeof effect === 'string') throw new Error('Missing dotted path effect');
        expect(effect.type).toBe('skDashPathEffect');
      }
    }
    if (view.root === null) throw new Error('Missing screen root');
    expect(themeProblems(view.root, scheme)).toEqual([]);
    expect(accessibilityProblems(view.root)).toEqual([]);
    expect(targetProblems(view.root)).toEqual([]);
    const action = view.getByRole('button', { name: entry.actionCopy });
    expect(action).toHaveTextContent(entry.actionCopy);
    const initial = skyAlphas(view);
    expect(initial[entry.atlasIndex]?.length).toBeGreaterThan(0);
    await advance(700);
    const running = skyAlphas(view);
    expect(running.filter((sky, index) => sky.some((alpha, star) => alpha !== initial[index]?.[star]))).toHaveLength(1);
    if (entry.animated) expect(running[entry.atlasIndex]).not.toEqual(initial[entry.atlasIndex]);
    else expect(running[entry.atlasIndex]).toEqual(initial[entry.atlasIndex]);
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    await view.rerender(current.tree(false));
    expect(cancel).toHaveBeenCalled();
    const frozen = skyAlphas(view);
    await advance(700);
    expect(skyAlphas(view)).toEqual(frozen);
    expect(repeat).not.toHaveBeenCalled();
    await view.rerender(current.tree(true));
    const resumed = skyAlphas(view);
    await advance(700);
    expect(skyAlphas(view)).not.toEqual(resumed);
    await fireEvent.press(view.getByRole('button', { name: entry.actionCopy }));
    expect(current.action).toHaveBeenCalledTimes(1);
  });

  test.each(['light', 'dark'] as const)('%s Reduce Motion keeps the scene and all sky canvases still', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    current = await entry.prepare();
    const view = await render(current.tree(true));
    expect(view.getByText(entry.copy)).toBeOnTheScreen();
    expect(view.getByRole('button', { name: entry.actionCopy })).toHaveTextContent(entry.actionCopy);
    const frozen = skyAlphas(view);
    expect(frozen[entry.atlasIndex]?.length).toBeGreaterThan(0);
    await advance(2100);
    expect(skyAlphas(view)).toEqual(frozen);
    expect(repeat).not.toHaveBeenCalled();
  });
});

describe.each(['light', 'dark'] as const)('P7-3 09 %s empty-state boundaries', (scheme) => {
  beforeEach(() => { jest.mocked(useColorScheme).mockReturnValue(scheme); });

  test.each([0, 1])('R2.6 profile with %i weight entries shows guidance and a working action', async (count) => {
    const c = await petContext();
    const pet = c.seedPet();
    if (count === 1) {
      const weight = c.factory.weight_entries({ pet_id: pet.id });
      c.driver.transaction(() => { c.apply.applyLocalRow('weight_entries', weight); });
    }
    current = { dispose: c.dispose, requests: () => c.http.requests, action: c.onAdd,
      tree: (active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
        <HeroProvider active={active}><PetProfileScreen services={c.services} petId={pet.id} active={active}
          onEdit={noop} onAddWeight={c.onAdd} onAddHealth={noop} onOpenHealth={noop} onWalks={noop} />
        </HeroProvider>
      </AssetFilesProvider></ReplicaProvider> };
    const view = await render(current.tree(true));
    expect(view.getByText(strings.weights.empty)).toBeOnTheScreen();
    expect(view.queryByTestId('weight-chart')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: strings.weights.add }));
    expect(c.onAdd).toHaveBeenCalledTimes(1);
  });

  test('09 section 6.1 no dogs keeps the walk scene and explanation without offering a walk', async () => {
    const c = await historyContext();
    c.seedPet({ species: 'cat' });
    c.seedPet({ species: 'dog', archived_at: new Date(c.clock.now()).toISOString() });
    current = { dispose: c.dispose, requests: () => c.http.requests, action: c.onStart,
      tree: (active) => <ReplicaProvider store={c.store}>
        <WalksScreen services={c.services} active={active} locationState="granted"
          onStart={c.onStart} onResume={c.onResume} onOpenWalk={c.onOpenWalk}
          onRequestLocation={c.onRequestLocation} onOpenSettings={c.onOpenSettings} />
      </ReplicaProvider> };
    const view = await render(current.tree(true));
    expect(view.getByText(strings.walks.emptyTitle)).toBeOnTheScreen();
    expect(view.getByText(strings.walks.noDogs)).toBeOnTheScreen();
    expect(view.container.queryAll((node) => node.type === 'skOval')).toHaveLength(1);
    expect(view.queryByTestId('walk-start')).toBeNull();
    expect(view.queryByTestId('walk-resume')).toBeNull();
    expect(c.onStart).not.toHaveBeenCalled();
  });

  test.each(['event', 'care'] as const)('R2.12 R2.14 adding a health %s replaces the empty scene immediately', async (kind) => {
    const c = await petContext();
    const pet = c.seedPet();
    current = { dispose: c.dispose, requests: () => c.http.requests, action: c.onAdd,
      tree: (active) => <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
        <HeroProvider active={active}><PetProfileScreen services={c.services} petId={pet.id} active={active}
          onEdit={noop} onAddWeight={noop} onAddHealth={c.onAdd} onOpenHealth={noop} onWalks={noop} />
        </HeroProvider>
      </AssetFilesProvider></ReplicaProvider> };
    const view = await render(current.tree(true));
    expect(view.getByText(strings.health.emptyTitle)).toBeOnTheScreen();
    let rowId = '';
    await act(() => {
      c.driver.transaction(() => {
        if (kind === 'event') {
          const event = c.factory.health_events({ pet_id: pet.id });
          c.apply.applyLocalRow('health_events', event);
          rowId = `health-event-${event.id}`;
        } else {
          const task = c.factory.task_templates({ category: 'vet', pet_ids: [pet.id], completion_mode: 'together' });
          const completion = c.factory.task_completions({ task_id: task.id, pet_id: null });
          c.apply.applyLocalRow('task_templates', task);
          c.apply.applyLocalRow('task_completions', completion);
          rowId = `health-care-${completion.id}`;
        }
      });
    });
    expect(view.getByTestId(rowId)).toBeOnTheScreen();
    expect(view.queryByText(strings.health.emptyTitle)).toBeNull();
    const scenes = view.container.queryAll((node) => node.type === 'skGroup'
      && Array.isArray(node.props.transform) && node.props.transform.length === 3);
    expect(scenes.length).toBe(0);
    expect(view.getAllByTestId('health-add')).toHaveLength(1);
    expect(view.getByTestId('health-schedule')).toBeOnTheScreen();
  });
});
