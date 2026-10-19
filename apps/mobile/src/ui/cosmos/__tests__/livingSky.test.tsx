import type { SkColor } from '@shopify/react-native-skia';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { systemClock } from '../../../platform/clock';
import { fakeClock } from '../../../testing/fakeClock';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { morningStarTint, planetTints, starfield } from '../../tokens/cosmos';
import { generateSky, generateSkyEventSchedule } from '../sky';
import { StarCheck } from '../StarCheck';
import { Starfield } from '../Starfield';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const frameAnimation = jest.requireActual<Pick<AnimationAPI, 'useFrameCallback'>>(`${animationRoot}/hook/useFrameCallback`);
const initialAppState = AppState.currentState;
type RenderedView = Awaited<ReturnType<typeof render>>;
let clock: ReturnType<typeof fakeClock>;

function readValue<T>(value: T | SharedValue<T>): T {
  return typeof value === 'object' && value !== null && 'get' in value
    ? (value as SharedValue<T>).get() : value as T;
}

function starAlphas(view: RenderedView): number[] {
  const atlases = view.container.queryAll((node) => node.type === 'skAtlas');
  expect(atlases).toHaveLength(1);
  const colors = readValue(atlases[0]?.props.colors as SkColor[] | SharedValue<SkColor[]>);
  expect(colors).toHaveLength(160);
  return colors.map((color) => color[3] ?? 0);
}

function planetAlphas(view: RenderedView): number[] {
  const planets = view.container.queryAll((node) => node.type === 'skCircle'
    && planetTints.some((tint) => tint === node.props.color));
  expect(planets).toHaveLength(2);
  return planets.map((planet) => readValue(planet.props.opacity as number | SharedValue<number>));
}

async function advance(milliseconds: number): Promise<void> {
  clock.advance(milliseconds);
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  clock = fakeClock(0);
  jest.spyOn(systemClock, 'now').mockImplementation(clock.now);
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('06 §4.1 a planet holds its alpha while the sky clock twinkles stars', async () => {
  const view = await render(<Starfield active seed={42} width={360} height={800} density="full" />);
  await advance(0);
  const planets = planetAlphas(view);
  const stars = starAlphas(view);
  for (const alpha of planets) {
    expect(alpha).toBeGreaterThanOrEqual(0.45);
    expect(alpha).toBeLessThanOrEqual(0.6);
  }
  await advance(700);
  expect(planetAlphas(view)).toEqual(planets);
  expect(starAlphas(view)).not.toEqual(stars);
  await advance(1100);
  expect(planetAlphas(view)).toEqual(planets);
});

test('06 §4.1 dawn keeps only magnitudes 1–2 and one steady morning star', async () => {
  jest.mocked(useColorScheme).mockReturnValue('light');
  const sky = generateSky(42, { width: 360, height: 800, density: 'full' });
  const bright = sky.stars.filter((star) => star.magnitude <= 2);
  expect(bright.length).toBeGreaterThan(0);
  expect(bright.length).toBeLessThan(sky.stars.length);
  const view = await render(<Starfield active={false} seed={42} width={360} height={800} density="full" />);
  const atlases = view.container.queryAll((node) => node.type === 'skAtlas');
  expect(atlases).toHaveLength(1);
  const transforms = readValue(atlases[0]?.props.transforms as unknown[] | SharedValue<unknown[]>);
  expect(transforms).toHaveLength(bright.length);
  const morning = view.container.queryAll((node) => node.type === 'skCircle' && node.props.color === morningStarTint);
  expect(morning).toHaveLength(1);
  expect(morning[0]?.props.r).toBe(2.4);
  expect(morning[0]?.props.cy).toBe(640);
  expect(readValue(morning[0]?.props.opacity as number | SharedValue<number>)).toBe(0.9);
  expect(view.container.queryAll((node) => node.type === 'skCircle'
    && planetTints.some((tint) => tint === node.props.color))).toHaveLength(0);
  expect(view.container.queryAll((node) => node.type === 'skLine')).toHaveLength(0);
});

test.each(['focus', 'background'] as const)('P5-14 R3/06 §5 %s freezes the sky and resumes without counting time away', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const view = await render(<Starfield active seed={42} width={360} height={800} density="full" />);
  await advance(0);
  const initial = starAlphas(view);
  await advance(700);
  const running = starAlphas(view);
  expect(running).not.toEqual(initial);
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else {
    await view.rerender(<Starfield active={false} seed={42} width={360} height={800} density="full" />);
  }
  await advance(0);
  expect(starAlphas(view)).toEqual(running);
  const planets = planetAlphas(view);
  await advance(10000);
  expect(starAlphas(view)).toEqual(running);
  expect(planetAlphas(view)).toEqual(planets);

  if (reason === 'background') {
    await act(() => { AppState.currentState = 'active'; listeners.forEach((notify) => notify('active')); });
  } else {
    await view.rerender(<Starfield active seed={42} width={360} height={800} density="full" />);
  }
  const sky = generateSky(42, { width: 360, height: 800, density: 'full' });
  // The sine's maximum slope bounds each alpha's change over one 16 ms frame.
  // Check the first two frames so a delayed first callback cannot hide a jump.
  let previous = running;
  for (let frame = 0; frame < 2; frame += 1) {
    await advance(16);
    const resumed = starAlphas(view);
    for (const [index, star] of sky.stars.entries()) {
      const base = starfield.alpha.minimum + (6 - star.magnitude) * starfield.alpha.step;
      const amplitude = starfield.amplitude[star.magnitude <= 2 ? 0 : star.magnitude <= 4 ? 1 : 2];
      const maximumChange = base * amplitude * Math.PI * 16 / star.period;
      expect(Math.abs((resumed[index] ?? 0) - (previous[index] ?? 0))).toBeLessThanOrEqual(maximumChange + 1e-7);
    }
    previous = resumed;
  }
  expect(previous).not.toEqual(running);
});

test.each(['meteor', 'satellite'] as const)('P5-14 R2 the %s is visible only within its scheduled window', async (kind) => {
  const schedule = generateSkyEventSchedule(42, starfield.scheduleCount);
  const start = (kind === 'meteor' ? schedule.meteors : schedule.satellites)[0];
  if (start === undefined) throw new Error('The first sky event is missing');
  const view = await render(<Starfield active seed={42} width={360} height={800} density="full" />);
  const events = view.container.queryAll((node) => kind === 'meteor' ? node.type === 'skLine'
    : node.type === 'skCircle' && node.props.r === starfield.satellite.radius);
  expect(events).toHaveLength(1);
  const opacity = (): number => readValue(events[0]?.props.opacity as number | SharedValue<number>);
  const minimumDuration = kind === 'meteor' ? starfield.meteor.duration : starfield.satellite.duration[0];
  const maximumDuration = kind === 'meteor' ? starfield.meteor.duration : starfield.satellite.duration[1];

  for (const [milliseconds, alpha] of [
    [start - 32, 0],
    [32 + minimumDuration / 2, kind === 'meteor' ? 1 : starfield.satellite.alpha],
    [maximumDuration - minimumDuration / 2 + 32, 0],
  ] as const) {
    clock.advance(milliseconds);
    await act(() => { jest.advanceTimersByTime(milliseconds); });
    expect(opacity()).toBe(alpha);
  }
}, 60000);

test('06 §5/MO-3 Reduce Motion starts no clock or withRepeat and draws no meteor', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const frame = jest.spyOn(frameAnimation, 'useFrameCallback');
  const view = await render(<Starfield active seed={42} width={360} height={800} density="full" />);
  await advance(0);
  expect(repeat).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
  expect(frame.mock.calls.every(([, autostart]) => autostart === false)).toBe(true);
  expect(frame.mock.results.every((result) => result.type === 'return' && result.value.isActive === false)).toBe(true);
  const still = starAlphas(view);
  // Cross several meteor windows; a reduced sky never draws an event.
  for (const interval of [18000, 27000, 45000, 30000]) {
    await advance(interval);
    expect(starAlphas(view)).toEqual(still);
    expect(view.container.queryAll((node) => node.type === 'skLine')).toHaveLength(0);
  }
  expect(repeat).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
});

test('06 §4.2 StarCheck emits 14 particles and a ring and removes its canvas when done', async () => {
  const onPress = jest.fn();
  const props = { active: true, accessibilityLabel: 'Scheduled care', occurrenceKey: 'care|2026-10-19|08:00', onPress };
  const view = await render(<StarCheck {...props} checked={false} testID="care" />);
  expect(screen.queryByTestId('care-burst', { includeHiddenElements: true })).toBeNull();
  await fireEvent.press(screen.getByRole('checkbox'));
  await view.rerender(<StarCheck {...props} checked testID="care" />);
  const canvas = screen.queryByTestId('care-burst', { includeHiddenElements: true });
  expect(canvas).not.toBeNull();
  const sparkles = view.container.queryAll((node) => node.type === 'skPath' && node.props.style !== 'stroke');
  const motes = view.container.queryAll((node) => node.type === 'skCircle' && node.props.style !== 'stroke');
  const ring = view.container.queryAll((node) => node.type === 'skCircle' && node.props.style === 'stroke');
  expect(sparkles).toHaveLength(8);
  expect(motes).toHaveLength(6);
  expect(sparkles.length + motes.length).toBe(14);
  expect(ring).toHaveLength(1);
  expect(ring[0]?.props.strokeWidth).toBe(1.5);
  await advance(350);
  expect(screen.queryByTestId('care-burst', { includeHiddenElements: true })).not.toBeNull();
  await advance(600);
  expect(screen.queryByTestId('care-burst', { includeHiddenElements: true })).toBeNull();
  expect(view.container.queryAll((node) => node.type === 'skPath' || node.type === 'skCircle')).toHaveLength(0);
  expect(onPress).toHaveBeenCalledTimes(1);
});
