import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState, type ReactElement } from 'react';
import { AppState, Linking, StyleSheet, useColorScheme, type AppStateStatus, type ViewStyle } from 'react-native';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { Skeleton } from '../../primitives/Skeleton';
import { Text } from '../../primitives/Text';
import { dark, light } from '../../tokens/color';
import { ConstellationLine } from '../ConstellationLine';
import { insurgeMark } from '../glyphs';
import { ClearSky } from '../illustrations/ClearSky';
import { EmptyHealth } from '../illustrations/EmptyHealth';
import { EmptyPets } from '../illustrations/EmptyPets';
import { EmptyWalks } from '../illustrations/EmptyWalks';
import { InsurgeMark } from '../insurgeMark';
import { Orbit } from '../Orbit';
import { PoweredBy } from '../PoweredBy';
import { ShootingStars } from '../ShootingStars';
import { StarCheck } from '../StarCheck';
import { Starfield } from '../Starfield';
import { generateSky, starRadius } from '../sky';
import { Skia } from '@shopify/react-native-skia';
import { morningStarTint, planetTints, starTints } from '../../tokens/cosmos';
import { atlasAlphas, atlasColors, atlasTransforms } from './skyDrawing';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
// Spy on the same real exports as P4-1; the public barrel is read-only.
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
type RenderedView = Awaited<ReturnType<typeof render>>;

function drawNodes(view: RenderedView, type: string) {
  return view.container.queryAll((node) => node.type === type);
}

function CheckHarness({ onPress }: { onPress: () => void }): ReactElement {
  const [checked, setChecked] = useState(false);
  return <StarCheck active checked={checked} accessibilityLabel="Scheduled care" testID="care-check"
    onPress={() => { onPress(); setChecked(true); }} />;
}

beforeEach(() => {
  // Expo supplies Linking.openURL as a Jest mock; restoring spies does not
  // clear that mock's call history between the light and dark link cases.
  jest.clearAllMocks();
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

describe('StarCheck', () => {
  test('gives scale feedback on press-in without committing', async () => {
    const onPress = jest.fn();
    const haptic = jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
    await render(<CheckHarness onPress={onPress} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Scheduled care', checked: false });
    await fireEvent(checkbox, 'pressIn');
    await act(async () => { await jest.advanceTimersByTimeAsync(1200); });
    expect(checkbox).toHaveAnimatedStyle({ transform: [{ scale: 0.92 }] });
    expect(onPress).not.toHaveBeenCalled();
    expect(haptic).not.toHaveBeenCalled();
    await fireEvent(checkbox, 'pressOut');
    await act(async () => { await jest.advanceTimersByTimeAsync(1200); });
    expect(checkbox).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { checked: false })).toBeOnTheScreen();
  });

  test('lights the star and fires one haptic on release', async () => {
    const onPress = jest.fn();
    const haptic = jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
    await render(<CheckHarness onPress={onPress} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Scheduled care', checked: false });
    await fireEvent(checkbox, 'pressIn');
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent(checkbox, 'pressOut');
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(checkbox);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('checkbox', { name: 'Scheduled care', checked: true })).toBeOnTheScreen();
    expect(screen.getByTestId('care-check-star', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('care-check-sparks', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  test('emits no sparks under reduce motion', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const spring = jest.spyOn(springAnimation, 'withSpring');
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    await render(<CheckHarness onPress={jest.fn()} />);
    await fireEvent.press(screen.getByRole('checkbox', { checked: false }));
    expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('care-check-sparks', { includeHiddenElements: true })).toBeNull();
    expect(spring).not.toHaveBeenCalled();
    expect(timing.mock.calls.some(([, config]) => config?.duration === 120)).toBe(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    expect(screen.getByTestId('care-check-star', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  test('is a checkbox to assistive technology and announces its state', async () => {
    const onPress = jest.fn();
    const view = await render(<StarCheck active checked={false} accessibilityLabel="Scheduled care" onPress={onPress} />);
    const unchecked = screen.getByRole('checkbox', { name: 'Scheduled care', checked: false });
    const style = StyleSheet.flatten<ViewStyle>(unchecked.props.style) ?? {};
    expect(Math.max(typeof style.minWidth === 'number' ? style.minWidth : 0, typeof style.width === 'number' ? style.width : 0)).toBeGreaterThanOrEqual(44);
    expect(Math.max(typeof style.minHeight === 'number' ? style.minHeight : 0, typeof style.height === 'number' ? style.height : 0)).toBeGreaterThanOrEqual(44);
    await view.rerender(<StarCheck active checked accessibilityLabel="Scheduled care" onPress={onPress} />);
    expect(screen.getByRole('checkbox', { name: 'Scheduled care', checked: true })).toBeOnTheScreen();
    await view.rerender(<StarCheck active checked disabled accessibilityLabel="Scheduled care" onPress={onPress} />);
    const disabled = screen.getByRole('checkbox', { name: 'Scheduled care', checked: true });
    expect(disabled).toBeDisabled();
    await fireEvent.press(disabled);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Starfield', () => {
  test('generateSky is deterministic for a seed and stays inside the bounds', async () => {
    const view = await render(<Starfield active={false} seed={42} width={360} height={240} density="header" />);
    const expected = generateSky(42, { width: 360, height: 240, density: 'band' }).stars;
    const points = atlasTransforms(view).map((transform, index) => {
      const star = expected[index];
      if (star === undefined) throw new Error('Missing generated star');
      const inset = starRadius(star.magnitude) * 2;
      return { x: transform.tx + inset, y: transform.ty + inset };
    });
    expect(points).toHaveLength(70);
    points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(expected[index]?.x ?? 0);
      expect(point.y).toBeCloseTo(expected[index]?.y ?? 0);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(360);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(240);
    });
    const retained = atlasTransforms(view).map((transform) => [transform.tx, transform.ty]);
    await view.rerender(<Starfield active={false} seed={42} width={360} height={240} density="header" />);
    expect(atlasTransforms(view).map((transform) => [transform.tx, transform.ty])).toEqual(retained);
    await view.rerender(<Starfield active={false} seed={42} width={360} height={800} density="full" />);
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(atlasTransforms(view)).toHaveLength(160);
  });

  test('stops its shared clock when the screen loses focus', async () => {
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    const view = await render(<Starfield active={false} seed={42} width={360} height={240} testID="sky" />);
    expect(repeat).not.toHaveBeenCalled();
    await view.rerender(<Starfield active seed={42} width={360} height={240} testID="sky" />);
    const initial = atlasAlphas(view);
    await act(async () => { await jest.advanceTimersByTimeAsync(700); });
    expect(atlasAlphas(view)).not.toEqual(initial);
    cancel.mockClear();
    repeat.mockClear();
    await view.rerender(<Starfield active={false} seed={42} width={360} height={240} testID="sky" />);
    const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
    expect(stopped).toHaveLength(1);
    const values = stopped.map((value) => value.value);
    const drawing = atlasAlphas(view);
    await act(async () => { await jest.advanceTimersByTimeAsync(10600); });
    expect(stopped.map((value) => value.value)).toEqual(values);
    expect(atlasAlphas(view)).toEqual(drawing);
    expect(repeat).not.toHaveBeenCalled();
    expect(screen.getByTestId('sky', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(drawNodes(view, 'skAtlas')).toHaveLength(1);
  });

  test.each(['light', 'dark'] as const)('renders in %s from tokens only', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const color = scheme === 'light' ? light : dark;
    const gradient = jest.spyOn(Skia.Shader, 'MakeLinearGradient');
    const view = await render(<Starfield active={false} seed={42} width={360} height={240} nebula testID="sky" />);
    expect(screen.getByTestId('sky', { includeHiddenElements: true })).toHaveStyle({ width: 360, height: 240 });
    expect(drawNodes(view, 'View')).toHaveLength(1);
    expect(drawNodes(view, 'skPicture')).toHaveLength(1);
    expect(gradient).toHaveBeenCalledTimes(1);
    expect(gradient.mock.calls[0]?.[2]).toEqual([Skia.Color(color.skyTop), Skia.Color(color.skyBottom)]);
    const nebula = drawNodes(view, 'skRadialGradient').filter((node) =>
      [color.nebulaA, color.nebulaB].includes(node.props.colors[0]));
    expect(nebula).toHaveLength(2);
    expect(nebula.map((node) => (node.props.colors as string[])[0])).toEqual([color.nebulaA, color.nebulaB]);
    expect(drawNodes(view, 'skAtlas')).toHaveLength(1);
    const stars = generateSky(42, { width: 360, height: 240, density: 'band' }).stars
      .filter((star) => scheme === 'dark' || star.magnitude <= 2);
    expect(atlasColors(view).map((tint) => Array.from(tint).slice(0, 3)))
      .toEqual(stars.map((star) => Array.from(Skia.Color(scheme === 'light' ? color.starfield : star.tint)).slice(0, 3)));
    const palette = new Set<string>([...Object.values(color), ...starTints, ...planetTints, morningStarTint]);
    for (const node of view.container.queryAll((node) => typeof node.props.color === 'string')) {
      expect(palette.has(node.props.color)).toBe(true);
    }
    const sky = screen.getByTestId('sky', { includeHiddenElements: true });
    expect(sky.props.importantForAccessibility).toBe('no-hide-descendants');
    const picture = drawNodes(view, 'skPicture')[0]?.props.picture as unknown;
    await view.rerender(<Starfield active seed={42} width={360} height={240} nebula testID="sky" />);
    expect(drawNodes(view, 'skPicture')[0]?.props.picture).toBe(picture);
    expect(gradient).toHaveBeenCalledTimes(1);
  });

  test('P6 cancels its shared clock when the app enters the background', async () => {
    let notify: () => void = () => { throw new Error('Missing app lifecycle subscription'); };
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      notify = () => { (listener as (state: AppStateStatus) => void)('background'); };
      return { remove: jest.fn() };
    });
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    const view = await render(<Starfield active seed={42} width={360} height={240} testID="sky" />);
    const initial = atlasAlphas(view);
    await act(async () => { await jest.advanceTimersByTimeAsync(700); });
    expect(atlasAlphas(view)).not.toEqual(initial);
    cancel.mockClear();
    repeat.mockClear();
    await act(() => { AppState.currentState = 'background'; notify(); });
    expect(new Set(cancel.mock.calls.map(([value]) => value)).size).toBe(1);
    const drawing = atlasAlphas(view);
    await act(async () => { await jest.advanceTimersByTimeAsync(10600); });
    expect(atlasAlphas(view)).toEqual(drawing);
    expect(repeat).not.toHaveBeenCalled();
    expect(screen.getByTestId('sky', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('motion', () => {
  const cases = [
    ['Starfield', <Starfield key="sky" active seed={42} width={360} height={240} />],
    ['Orbit', <Orbit key="orbit" active satellite petId="pet-a" size={96} />],
    ['Skeleton', <Skeleton key="skeleton" active width={240} height={48} />],
    ['PoweredBy', <PoweredBy key="signature" active />],
  ] as const;

  test.each(cases)('MO-3 reduce motion starts no repeating animation in %s', async (_name, component) => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    await render(component);
    expect(repeat).not.toHaveBeenCalled();
  });
});

describe.each(['light', 'dark'] as const)('PoweredBy in %s', (scheme) => {
  beforeEach(() => { jest.mocked(useColorScheme).mockReturnValue(scheme); });

  test('06 §4.12 the signature row centres the mark and words vertically while the words share a baseline', async () => {
    const view = await render(<PoweredBy active={false} testID="signature" />);
    const rows = view.container.queryAll((node) => StyleSheet.flatten<ViewStyle>(node.props.style)?.flexDirection === 'row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveStyle({ alignItems: 'center', justifyContent: 'center', gap: 8 });
    const wordLines = view.container.queryAll((node) => node.type === 'Text'
      && node.queryAll((child) => child.props.children === 'powered by').length > 0
      && node.queryAll((child) => child.props.children === 'Insurge').length > 0);
    expect(wordLines).toHaveLength(1);
  });

  test('ADR-036 renders the mark and both words on one labelled line', async () => {
    const color = scheme === 'light' ? light : dark;
    const view = await render(<PoweredBy active={false} testID="signature" />);
    expect(screen.getByText('powered by')).toHaveStyle({ color: color.textMuted, fontSize: 12 });
    expect(screen.getByText('Insurge')).toHaveStyle({ color: color.text, fontSize: 14 });
    expect(screen.getAllByLabelText('powered by Insurge')).toHaveLength(1);
    expect(screen.getByLabelText('powered by Insurge')).toBe(screen.getByTestId('signature'));
    expect(screen.getByTestId('signature').props.accessible).toBe(true);
    expect(drawNodes(view, 'Text').every((node) => node.props.accessibilityLabel === undefined)).toBe(true);
    expect(screen.getByTestId('signature-mark', { includeHiddenElements: true })).toHaveStyle({ width: 18, height: 18 });
    const paths = view.container.queryAll((node) => typeof node.props.d === 'string');
    expect(paths.map((node) => (node.props.d as string).replace(/\s/g, '')))
      .toEqual([insurgeMark.back, insurgeMark.front].map((path) => path.replace(/\s/g, '')));
    expect(view.container.queryAll((node) => Number(node.props.r) === insurgeMark.ringRadius)).toHaveLength(1);
    expect(view.container.queryAll((node) => Number(node.props.r) === insurgeMark.horizonRadius)).toHaveLength(1);
  });

  test('ADR-036 is not pressable without an href', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<PoweredBy active={false} testID="signature" />);
    expect(screen.getByLabelText('powered by Insurge')).toBeOnTheScreen();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    await fireEvent.press(screen.getByTestId('signature'));
    expect(openURL).not.toHaveBeenCalled();
  });

  test('ADR-036 is a 44 dp link only when given an href', async () => {
    const href = 'https://insurge.pages.dev';
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<PoweredBy active={false} href={href} testID="signature" />);
    const link = screen.getByRole('link', { name: 'powered by Insurge' });
    const style = StyleSheet.flatten<ViewStyle>(link.props.style) ?? {};
    expect(Math.max(typeof style.minWidth === 'number' ? style.minWidth : 0, typeof style.width === 'number' ? style.width : 0)).toBeGreaterThanOrEqual(44);
    expect(Math.max(typeof style.minHeight === 'number' ? style.minHeight : 0, typeof style.height === 'number' ? style.height : 0)).toBeGreaterThanOrEqual(44);
    expect(screen.getAllByLabelText('powered by Insurge')).toHaveLength(1);
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(href);
  });
});

describe.each(['light', 'dark'] as const)('illustrations in %s', (scheme) => {
  beforeEach(() => { jest.mocked(useColorScheme).mockReturnValue(scheme); });
  const illustrations = [
    ['ClearSky', ClearSky], ['EmptyPets', EmptyPets], ['EmptyWalks', EmptyWalks], ['EmptyHealth', EmptyHealth],
  ] as const;

  test.each(illustrations)('%s renders a themed scene with a Starfield', async (_name, Illustration) => {
    const gradient = jest.spyOn(Skia.Shader, 'MakeLinearGradient');
    const view = await render(<Illustration active={false} width={240} height={160} testID="scene" />);
    expect(screen.getByTestId('scene', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(drawNodes(view, 'View')).toHaveLength(1);
    expect(drawNodes(view, 'skAtlas')).toHaveLength(1);
    const color = scheme === 'light' ? light : dark;
    expect(drawNodes(view, 'skPicture')).toHaveLength(1);
    expect(gradient.mock.calls.some(([, , colors]) => JSON.stringify(colors)
      === JSON.stringify([Skia.Color(color.skyTop), Skia.Color(color.skyBottom)]))).toBe(true);
    const palette = new Set<string>([...Object.values(color), ...starTints]);
    for (const node of view.container.queryAll((node) => typeof node.props.color === 'string')) {
      expect(palette.has(node.props.color)).toBe(true);
    }
    expect(view.container.queryAll((node) => ['skPath', 'skCircle', 'skOval', 'skLine'].includes(node.type)).length)
      .toBeGreaterThan(0);
  });
});

describe('cosmos pieces', () => {
  test('ConstellationLine joins supplied points only while the occurrence is complete', async () => {
    const points = [{ x: 24, y: 24 }, { x: 72, y: 24 }, { x: 120, y: 24 }];
    const view = await render(<ConstellationLine points={points} width={144} height={48} complete={false} active testID="constellation" />);
    expect(screen.queryByTestId('constellation', { includeHiddenElements: true })).toBeNull();
    await view.rerender(<ConstellationLine points={points} width={144} height={48} complete active testID="constellation" />);
    expect(screen.getByTestId('constellation', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(view.container.queryAll((node) => typeof node.props.d === 'string')).toHaveLength(1);
  });

  test('Orbit preserves avatar content and repeats only for a focused satellite', async () => {
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    const view = await render(<Orbit petId="pet-a" size={96} active><Text>Pet portrait</Text></Orbit>);
    expect(screen.getByText('Pet portrait')).toBeOnTheScreen();
    expect(repeat).not.toHaveBeenCalled();
    await view.rerender(<Orbit petId="pet-a" size={96} active satellite><Text>Pet portrait</Text></Orbit>);
    expect(repeat).toHaveBeenCalledTimes(1);
    cancel.mockClear();
    repeat.mockClear();
    await view.rerender(<Orbit petId="pet-a" size={96} active={false} satellite><Text>Pet portrait</Text></Orbit>);
    expect(cancel).toHaveBeenCalled();
    expect(repeat).not.toHaveBeenCalled();
    expect(screen.getByText('Pet portrait')).toBeOnTheScreen();
  });

  test('ShootingStars shares the Starfield canvas and schedules no motion under Reduce Motion', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    const spring = jest.spyOn(springAnimation, 'withSpring');
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const view = await render(<Starfield active seed={42} width={360} height={240}>
      <ShootingStars active play width={360} height={240} />
    </Starfield>);
    expect(drawNodes(view, 'View')).toHaveLength(1);
    expect(drawNodes(view, 'skAtlas')).toHaveLength(1);
    // Q-38 permits only a zero-duration cut to end the still bright hold.
    expect(timing.mock.calls.every(([, config]) => config?.duration === 0)).toBe(true);
    expect(spring).not.toHaveBeenCalled();
    expect(repeat).not.toHaveBeenCalled();
  });

  test('InsurgeMark breathes only while focused and cancels when inactive', async () => {
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    const view = await render(<InsurgeMark active={false} testID="mark" />);
    expect(screen.getByTestId('mark', { includeHiddenElements: true })).toHaveStyle({ width: 18, height: 18 });
    expect(repeat).not.toHaveBeenCalled();
    await view.rerender(<InsurgeMark active testID="mark" />);
    expect(repeat).toHaveBeenCalledTimes(1);
    cancel.mockClear();
    repeat.mockClear();
    await view.rerender(<InsurgeMark active={false} testID="mark" />);
    expect(cancel).toHaveBeenCalled();
    expect(repeat).not.toHaveBeenCalled();
  });
});
