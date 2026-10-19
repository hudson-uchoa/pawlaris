import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, useColorScheme, type AppStateStatus } from 'react-native';
import { AlphaType, ColorType, NodeType, Skia, type SkColor } from '@shopify/react-native-skia';
import type { Node } from '@shopify/react-native-skia/lib/typescript/src/sksg/Node';
import * as ReduceMotion from '../../motion/useReduceMotion';
import { dark } from '../../tokens/color';
import { ClearSky } from '../illustrations/ClearSky';
import { EmptyHealth } from '../illustrations/EmptyHealth';
import { EmptyPets } from '../illustrations/EmptyPets';
import { EmptyWalks } from '../illustrations/EmptyWalks';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
const scenes = [
  ['ClearSky', ClearSky], ['EmptyPets', EmptyPets], ['EmptyWalks', EmptyWalks], ['EmptyHealth', EmptyHealth],
] as const;

// Rasterize the rendered drawing with the installed Skia CPU backend. This
// checks pixels without prescribing a gradient or mask implementation.
const { StaticContainer } = jest.requireActual<
  typeof import('@shopify/react-native-skia/lib/typescript/src/sksg/StaticContainer')
>('@shopify/react-native-skia/lib/module/sksg/StaticContainer');

function backendColors(colors: SkColor[]): SkColor[] {
  // jestEnv initializes CanvasKit outside Jest's VM; its colour-array check
  // needs a typed array from that realm rather than the VM's Array class.
  const backend = globalThis as unknown as { CanvasKit: { Color(r: number, g: number, b: number): Float32Array } };
  const BackendFloat32Array = backend.CanvasKit.Color(0, 0, 0).constructor as Float32ArrayConstructor;
  return new BackendFloat32Array(colors.flatMap((color) => Array.from(color))) as unknown as SkColor[];
}

function drawing(node: Awaited<ReturnType<typeof render>>['container'] | string): Node {
  if (typeof node === 'string') throw new Error('Unexpected text inside the Skia scene');
  return { type: node.type as NodeType, props: node.props, children: node.children.map(drawing) };
}

describe.each(['light', 'dark'] as const)('06 §4.10 scenes in %s', (scheme) => {
  test.each(scenes)('%s sky fades to transparent along all four edges without a visible box', async (_name, Illustration) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const width = 240;
    const height = 160;
    await render(<Illustration width={width} height={height} active={false} testID="edge-scene" />);
    const scene = screen.getByTestId('edge-scene', { includeHiddenElements: true });
    const renderer = new StaticContainer(Skia, -1);
    renderer.root = scene.children.map(drawing);
    renderer.redraw();
    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (surface === null) throw new Error('The Skia test backend could not create a surface');
    try {
      renderer.drawOnCanvas(surface.getCanvas());
      surface.flush();
      const image = surface.makeImageSnapshot();
      try {
        const pixels = image.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
        if (pixels === null) throw new Error('The Skia test backend could not read pixels');
        const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3] ?? 0;
        const edges = [
          Array.from({ length: width }, (_, x) => alpha(x, 0)),
          Array.from({ length: width }, (_, x) => alpha(x, height - 1)),
          Array.from({ length: height }, (_, y) => alpha(0, y)),
          Array.from({ length: height }, (_, y) => alpha(width - 1, y)),
        ];
        // Allow subpixel antialiasing at the outermost pixel centres.
        for (const edge of edges) expect(Math.max(...edge)).toBeLessThanOrEqual(8);
        const inward = Array.from({ length: Math.floor(height / 2) }, (_, y) => alpha(width / 2, y));
        expect(Math.max(...inward)).toBeGreaterThan(8);
        expect(new Set(inward.filter((value) => value > 8 && value < 247)).size).toBeGreaterThan(2);
      } finally { image.dispose(); }
    } finally { renderer.unmount(); surface.dispose(); }
  });
});

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  const linear = Skia.Shader.MakeLinearGradient.bind(Skia.Shader);
  const radial = Skia.Shader.MakeRadialGradient.bind(Skia.Shader);
  jest.spyOn(Skia.Shader, 'MakeLinearGradient').mockImplementation((start, end, colors, ...rest) =>
    linear(start, end, backendColors(colors), ...rest));
  jest.spyOn(Skia.Shader, 'MakeRadialGradient').mockImplementation((center, radius, colors, ...rest) =>
    radial(center, radius, backendColors(colors), ...rest));
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('ClearSky draws a crescent and a few gold stars', async () => {
  const view = await render(<ClearSky width={240} height={160} active={false} />);
  const paths = view.container.queryAll((node) => node.type === 'skPath');
  const moons = paths.filter((node) => node.props.color === dark.textMuted);
  expect(moons).toHaveLength(1);
  expect((moons[0]?.props.path as string).match(/ A/g)).toHaveLength(2);
  expect(paths.filter((node) => node.props.color === dark.star)).toHaveLength(3);
});

test('EmptyPets draws a dotted paw with four toes, all unlit', async () => {
  const view = await render(<EmptyPets width={240} height={160} active={false} />);
  const pads = view.container.queryAll((node) => node.type === 'skPath');
  const toes = view.container.queryAll((node) => node.type === 'skCircle');
  expect(pads).toHaveLength(1);
  expect(toes).toHaveLength(4);
  for (const shape of [...pads, ...toes]) {
    expect(shape.props.style).toBe('stroke');
    expect(shape.props.color).toBe(dark.textMuted);
    expect(shape.children).toHaveLength(1);
    expect(shape.children[0]).toEqual(expect.objectContaining({ type: 'skDashPathEffect' }));
  }
  expect(view.container.queryAll((node) => node.props.color === dark.star)).toHaveLength(0);
});

test('EmptyWalks places a ring behind and in front of a planet within a dashed orbit', async () => {
  const view = await render(<EmptyWalks width={240} height={160} active={false} />);
  const orbit = view.container.queryAll((node) => node.type === 'skOval');
  expect(orbit).toHaveLength(1);
  expect(orbit[0]?.props.style).toBe('stroke');
  expect(orbit[0]?.children[0]).toEqual(expect.objectContaining({ type: 'skDashPathEffect' }));
  const shapes = view.container.queryAll((node) => node.type === 'skPath' || node.type === 'skCircle');
  expect(shapes.map((shape) => [shape.type, shape.props.color])).toEqual([
    ['skPath', dark.accent], ['skCircle', dark.accentSoft], ['skCircle', dark.accent], ['skPath', dark.accent],
  ]);
});

test('EmptyHealth draws one gold star above a horizontal horizon', async () => {
  const view = await render(<EmptyHealth width={240} height={160} active={false} />);
  const stars = view.container.queryAll((node) => node.type === 'skPath');
  const horizons = view.container.queryAll((node) => node.type === 'skLine');
  expect(stars).toHaveLength(1);
  expect(horizons).toHaveLength(1);
  expect(stars[0]?.props.color).toBe(dark.star);
  const from = horizons[0]?.props.p1 as { x: number; y: number };
  const to = horizons[0]?.props.p2 as { x: number; y: number };
  expect(from.y).toBe(to.y);
  expect(to.x).toBeGreaterThan(from.x);
  const vertices = [...(stars[0]?.props.path as string).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)];
  expect(vertices).toHaveLength(10);
  expect(Math.max(...vertices.map((vertex) => Number(vertex[2])))).toBeLessThan(from.y);
});

describe.each(scenes)('%s activity', (_name, Illustration) => {
  test.each(['focus', 'background', 'reduce motion'] as const)('P6/P9 %s cancels twinkle and preserves the still scene', async (reason) => {
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
      listeners.add(notify);
      return { remove: () => { listeners.delete(notify); } };
    });
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const view = await render(<Illustration width={240} height={160} active testID="scene" />);
    expect(repeat).toHaveBeenCalledTimes(3);
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    repeat.mockClear();
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    if (reason === 'background') {
      await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
    } else {
      if (reason === 'reduce motion') jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
      await view.rerender(<Illustration width={240} height={160} active={reason !== 'focus'} testID="scene" />);
    }
    const stopped = [...new Set(cancel.mock.calls.map(([value]) => value))];
    expect(stopped).toHaveLength(3);
    const values = stopped.map((value) => value.value);
    await act(async () => { await jest.advanceTimersByTimeAsync(10600); });
    expect(stopped.map((value) => value.value)).toEqual(values);
    expect(repeat).not.toHaveBeenCalled();
    expect(screen.getByTestId('scene', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('scene', { includeHiddenElements: true }).props.importantForAccessibility)
      .toBe('no-hide-descendants');
    expect(view.container.queryAll((node) => node.type === 'skPoints')).toHaveLength(3);
    expect(view.container.queryAll((node) => ['skPath', 'skCircle', 'skOval', 'skLine'].includes(node.type)).length)
      .toBeGreaterThan(0);
  });
});
