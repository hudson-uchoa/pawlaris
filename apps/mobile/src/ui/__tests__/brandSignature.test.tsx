import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, Linking, processColor, StyleSheet, useColorScheme, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { authContext } from '../../features/auth/__tests__/support';
import { LoginScreen } from '../../features/auth/LoginScreen';
import { PawStarMark } from '../../features/auth/PawStarMark';
import { settingsContext } from '../../features/settings/__tests__/support';
import { SettingsScreen } from '../../features/settings/SettingsScreen';
import { strings } from '../../i18n/strings';
import * as ReduceMotion from '../motion/useReduceMotion';
import { pawStar } from '../cosmos/glyphs';
import { dark, insurge, light } from '../tokens/color';
import { typography } from '../tokens/type';

type Node = ReturnType<typeof screen.getByTestId>;
let dispose: (() => void) | undefined;
const insets = { top: 24, bottom: 20, left: 0, right: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  dispose?.();
  dispose = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function parentOf(view: Awaited<ReturnType<typeof render>>, child: Node) {
  const parents = view.container.queryAll((node) => node.children.includes(child));
  expect(parents).toHaveLength(1);
  const parent = parents[0];
  if (parent === undefined) throw new Error('Missing parent');
  return parent;
}

function checkSignature(view: Awaited<ReturnType<typeof render>>, scheme: 'light' | 'dark') {
  const color = scheme === 'light' ? light : dark;
  const line = screen.getByTestId('powered-by');
  expect(screen.getAllByLabelText('powered by Insurge')).toEqual([line]);
  expect(line).toHaveProp('accessible', true);
  expect(strings.brand.poweredBy).toBe('powered by');
  expect(strings.brand.insurge).toBe('Insurge');
  expect(within(line).getByText(strings.brand.poweredBy)).toHaveStyle({
    ...typography.caption, color: color.textMuted,
  });
  expect(within(line).getByText(strings.brand.insurge)).toHaveStyle({
    ...typography.label, color: color.text,
  });
  expect(screen.getByTestId('powered-by-mark', { includeHiddenElements: true }))
    .toHaveStyle({ width: 18, height: 18 });
  const rows = line.queryAll((node) => StyleSheet.flatten<ViewStyle>(node.props.style)?.flexDirection === 'row');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveStyle({ gap: 8, alignItems: 'center', justifyContent: 'center' });
  expect(line).toHaveStyle({ alignItems: 'center', justifyContent: 'center' });
  const wordLines = line.queryAll((node) => node.type === 'Text'
    && node.queryAll((child) => child.props.children === strings.brand.poweredBy).length > 0
    && node.queryAll((child) => child.props.children === strings.brand.insurge).length > 0);
  expect(wordLines).toHaveLength(1);
  const ring = view.container.queryAll((node) => Number(node.props.r) === 12);
  expect(ring).toHaveLength(1);
  expect(ring[0]?.props.stroke).toEqual({ type: 0, payload: processColor(insurge.glow) });
  const horizon = view.container.queryAll((node) => Number(node.props.r) === 10.5);
  expect(horizon).toHaveLength(1);
  expect(horizon[0]?.props.fill).toEqual({ type: 0, payload: processColor(insurge.void) });
  const gradients = view.container.queryAll((node) => node.type === 'RNSVGLinearGradient'
    && node.props.gradient?.length === 6);
  expect(gradients).toHaveLength(1);
  expect(gradients[0]?.props.gradient).toEqual([
    0, Number(processColor(insurge.deep)) | 0,
    0.5, Number(processColor(insurge.violet)) | 0,
    1, Number(processColor(insurge.lavender)) | 0,
  ]);
}

test.each(['light', 'dark'] as const)(
  'P7-3 R7.7 06 section 4.12 login signature stays at the foot above the inset in %s', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const dimensions = Dimensions.get;
    let windowHeight = 800;
    jest.spyOn(Dimensions, 'get').mockImplementation((key) => ({
      ...dimensions(key), height: key === 'screen' ? 900 : windowHeight,
    }));
    const c = await authContext();
    dispose = c.dispose;
    const element = () => <SafeAreaInsetsContext.Provider value={insets}>
      <LoginScreen services={c.services} active={false} onRedeem={jest.fn()} />
    </SafeAreaInsetsContext.Provider>;
    const view = await render(element());
    checkSignature(view, scheme);
    const line = screen.getByTestId('powered-by');
    expect(line.props.onPress).toBeUndefined();
    expect(screen.queryByRole('link', { name: 'powered by Insurge' })).toBeNull();
    const footer = parentOf(view, line);
    const style = StyleSheet.flatten<ViewStyle>(footer.props.style);
    expect(style).toMatchObject({ position: 'absolute', left: 24, right: 24, justifyContent: 'center' });
    expect(Number(style?.top) + Number(style?.height)).toBe(900 - insets.bottom - 24);
    const form = view.container.queryAll((node) => node.type === 'ScrollView');
    expect(form.every((node) => node.queryAll((child) => child === line).length === 0)).toBe(true);
    // Android's keyboard resizes the window. The signature remains at the
    // physical screen's foot, where the keyboard covers it.
    windowHeight = 450;
    await view.rerender(element());
    expect(parentOf(view, screen.getByTestId('powered-by'))).toHaveStyle(style ?? {});
    await fireEvent.press(screen.getByTestId('powered-by'));
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
  },
);

test.each(['light', 'dark'] as const)(
  'P7-3 06 section 4.11 the login mark preserves master geometry, clearance and colour in %s', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const color = scheme === 'light' ? light : dark;
    const view = await render(<PawStarMark />);
    const svgs = view.container.queryAll((node) => node.type === 'RNSVGSvgView');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    if (svg === undefined) throw new Error('Missing mark');
    expect(Number(svg.props.bbWidth)).toBeGreaterThanOrEqual(24);
    expect(svg.props.bbWidth).toBe(svg.props.bbHeight);
    expect(svg.props).toMatchObject({ minX: 0, minY: 0, vbWidth: 512, vbHeight: 512 });
    expect(StyleSheet.flatten<ViewStyle>(parentOf(view, svg).props.style))
      .toEqual({ padding: Number(svg.props.bbWidth) * 100 / 512 });
    expect(view.container.queryAll((node) => typeof node.type === 'string' && node.type.includes('Image')))
      .toHaveLength(0);
    const paths = view.container.queryAll((node) => typeof node.props.d === 'string');
    expect(paths.map((node) => node.props.d)).toEqual([pawStar.pad, ...pawStar.toes.map((toe) => toe.path)]);
    expect(paths.slice(1).every((node) => node.props.fill?.payload === processColor(color.star))).toBe(true);
    expect(paths.every((node) => node.props.stroke === undefined || node.props.stroke === null)).toBe(true);
    const linear = view.container.queryAll((node) => node.type === 'RNSVGLinearGradient');
    expect(linear).toHaveLength(1);
    expect(linear[0]?.props).toMatchObject({ x1: '0%', x2: '0%', y1: '0%', y2: '100%' });
    expect(linear[0]?.props.gradient).toEqual([
      0, Number(processColor(color.padTop)) | 0, 1, Number(processColor(color.padBottom)) | 0,
    ]);
    expect(paths[0]?.props.fill).toEqual({ type: 1, brushRef: linear[0]?.props.name });
    const radial = view.container.queryAll((node) => node.type === 'RNSVGRadialGradient');
    expect(radial).toHaveLength(1);
    const gradient = radial[0]?.props.gradient as number[];
    // React Native SVG packs each stop's alpha into its ARGB colour.
    expect((gradient[1] ?? 0) >>> 24).toBe(scheme === 'dark' ? 128 : 51);
    expect((gradient[3] ?? 0) >>> 24).toBe(0);
    const glows = view.container.queryAll((node) => Number(node.props.r) === 118);
    expect(glows).toHaveLength(1);
    expect(glows[0]?.props).toMatchObject({ cx: 330, cy: 150 });
    expect(pawStar.toes.map(({ x, y, radius, rotation }) => ({ x, y, radius, rotation }))).toEqual([
      { x: 108, y: 264, radius: 50, rotation: -14 },
      { x: 184, y: 156, radius: 58, rotation: -5 },
      { x: 330, y: 150, radius: 75.4, rotation: 5 },
      { x: 404, y: 264, radius: 50, rotation: 14 },
    ]);
  },
);

test.each(['light', 'dark'] as const)(
  'P7-3 R7.7 06 section 4.12 settings signature follows the author below logout in %s', async (scheme) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const c = await settingsContext();
    dispose = c.dispose;
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = await render(<SafeAreaInsetsContext.Provider value={insets}>
      <SettingsScreen services={c.services} active={false} onOpen={c.onOpen} />
    </SafeAreaInsetsContext.Provider>);
    checkSignature(view, scheme);
    const line = screen.getByRole('link', { name: 'powered by Insurge' });
    expect(line).toBe(screen.getByTestId('powered-by'));
    expect(line).toHaveStyle({ minWidth: 44, minHeight: 44 });
    const author = screen.getByTestId('settings-author');
    expect(author).toHaveTextContent(strings.settings.author);
    expect(author).toHaveStyle({ ...typography.caption,
      color: (scheme === 'light' ? light : dark).textMuted, textAlign: 'center' });
    const footer = parentOf(view, line);
    expect(footer.children).toEqual([author, line]);
    expect(footer).toHaveStyle({ alignItems: 'center' });
    const content = parentOf(view, footer);
    const index = content.children.indexOf(footer);
    const previous = content.children[index - 1];
    expect(previous).toBe(screen.getByTestId('logout'));
    const footerStyle = StyleSheet.flatten<ViewStyle>(footer.props.style);
    const contentStyle = StyleSheet.flatten<ViewStyle>(parentOf(view, content).props.contentContainerStyle);
    expect(Number(footerStyle?.marginTop) + Number(contentStyle?.gap)).toBe(32);
    await fireEvent.press(line);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://insurge.pages.dev');
    expect(c.http.requests).toEqual([]);
  },
);
