import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, View, useColorScheme } from 'react-native';
import { LinearTransition, type SharedValue } from 'react-native-reanimated';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { createStartupMarker } from '../../../perf/marker';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { dark, light } from '../../../ui/tokens/color';
import { DashboardScreen } from '../DashboardScreen';
import { DashboardEntry } from '../DashboardEntry';
import { dashboardContext, type DashboardContext } from './support';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const delayAnimation = jest.requireActual<Pick<AnimationAPI, 'withDelay'>>(`${animationRoot}/animation/delay`);
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
  expect(context?.http.requests ?? []).toEqual([]);
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene() {
  const c = await dashboardContext();
  context = c;
  return c;
}

function tree(c: DashboardContext, active = true) {
  return <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <DashboardScreen services={c.services} active={active} onAdd={c.onAdd} onManage={c.onManage} onOpenPet={c.onOpenPet} />
  </AssetFilesProvider></ReplicaProvider>;
}

function transforms(view: Awaited<ReturnType<typeof render>>) {
  return view.container.queryAll((node) => node.type === 'skGroup' && node.props.transform !== undefined)
    .map((node) => node.props.transform as SharedValue<{ translateY: number }[]>);
}

test.each(['light', 'dark'] as const)('P9 dashboard uses %s tokens and keeps only the header sky animated', async (scheme) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  const c = await scene();
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const view = await render(tree(c));
  const colors = scheme === 'light' ? light : dark;
  expect(screen.getByTestId('dashboard')).toHaveStyle({ backgroundColor: colors.bg });
  const gradients = view.container.queryAll((node) => node.type === 'skLinearGradient');
  expect(gradients.map((node) => node.props.colors)).toEqual([
    [colors.skyTop, colors.skyBottom], [colors.skyTop, colors.skyBottom],
  ]);
  expect(view.container.queryAll((node) => node.type === 'skPoints')).toHaveLength(6);
  expect(view.container.queryAll((node) => node.type === 'skPath')).toHaveLength(4);
  expect(repeat).toHaveBeenCalledTimes(3);
});

test('P6 dashboard scroll drives the three header parallax layers', async () => {
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const view = await render(tree(c));
  const layers = transforms(view);
  expect(layers).toHaveLength(3);
  await fireEvent.scroll(screen.getByTestId('dashboard-list'), {
    nativeEvent: { contentOffset: { x: 0, y: 120 }, contentSize: { width: 360, height: 1200 },
      layoutMeasurement: { width: 360, height: 720 } },
  });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(layers.map((value) => value.get()[0]?.translateY)).toEqual([-4.8, -9.6, -19.2]);
});

test('P6 P9 an inactive dashboard stops ambient motion and does not replay card entry on focus', async () => {
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const view = await render(tree(c));
  expect(transforms(view)).toHaveLength(3);
  expect(delay).toHaveBeenCalledTimes(1);
  delay.mockClear();
  repeat.mockClear();
  await view.rerender(tree(c, false));
  expect(transforms(view)).toHaveLength(0);
  await act(async () => { await jest.advanceTimersByTimeAsync(10_600); });
  expect(repeat).not.toHaveBeenCalled();
  expect(delay).not.toHaveBeenCalled();
  await view.rerender(tree(c));
  expect(transforms(view)).toHaveLength(3);
  expect(repeat).toHaveBeenCalledTimes(3);
  expect(delay).not.toHaveBeenCalled();
});

test('P9 reduced dashboard renders still stars and cards without parallax or entry animation', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  const view = await render(tree(c));
  expect(transforms(view)).toHaveLength(0);
  expect(view.container.queryAll((node) => node.type === 'skPoints')).toHaveLength(3);
  expect(repeat).not.toHaveBeenCalled();
  expect(delay).not.toHaveBeenCalled();
  for (const entry of screen.getAllByTestId(/^entry-/)) {
    expect(entry).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  }
});

test('06-4.8 the first six cards enter once with a 12 dp rise and 40 ms stagger', async () => {
  const entered = new Set<string>();
  const delay = jest.spyOn(delayAnimation, 'withDelay');
  function entries(enabled: boolean) {
    return <View>{Array.from({ length: 7 }, (_, index) => <DashboardEntry key={index} id={`card-${index}`}
      index={index} entered={entered} enabled={enabled}><View /></DashboardEntry>)}</View>;
  }
  const view = await render(entries(true));
  expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([0, 40, 80, 120, 160, 200]);
  expect(screen.getByTestId('entry-card-0')).toHaveAnimatedStyle({ opacity: 0, transform: [{ translateY: 12 }] });
  expect(screen.getByTestId('entry-card-6')).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  await view.rerender(entries(false));
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  for (const entry of screen.getAllByTestId(/^entry-/)) {
    expect(entry).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  }
  delay.mockClear();
  await view.rerender(entries(true));
  await view.unmount();
  await render(entries(true));
  expect(delay).not.toHaveBeenCalled();
});

test('P6 P9 dashboard layout transitions are configured only while motion is enabled', async () => {
  const c = await scene();
  const pet = c.seedPet();
  c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const build = jest.spyOn(LinearTransition, 'build');
  const view = await render(tree(c));
  expect(build).toHaveBeenCalled();
  build.mockClear();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  await view.rerender(tree(c));
  expect(build).not.toHaveBeenCalled();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  await view.rerender(tree(c, false));
  expect(build).not.toHaveBeenCalled();
});

test('R6.1 dashboard marks the ready layout once through the startup marker', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const c = await scene();
  const output = jest.fn();
  c.services.marker = createStartupMarker(output);
  await render(tree(c));
  expect(output).not.toHaveBeenCalled();
  const event = { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 720 } } };
  await fireEvent(screen.getByTestId('dashboard'), 'layout', event);
  await fireEvent(screen.getByTestId('dashboard'), 'layout', event);
  expect(c.services.afterFirstPaint).toHaveBeenCalled();
  expect(output).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledWith('PAWLARIS_PERF dashboard_interactive');
});
