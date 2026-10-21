import './maplibreMock';
import { Map } from '@maplibre/maplibre-react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import { strings } from '../../../i18n/strings';
import { dark, light } from '../../../ui/tokens/color';
import { WALK_TILE_URL } from '../tiles';
import { WalkMap } from '../WalkMap';

declare const __dirname: string;

const appearance = jest.requireActual<Pick<typeof import('react-native'), 'useColorScheme'>>('react-native');
const { readFileSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('node:fs');
const { resolve } = jest.requireActual<{
  resolve(...paths: string[]): string;
}>('node:path');
const { execFileSync } = jest.requireActual<{
  execFileSync(file: string, args: readonly string[], options: {
    cwd: string; encoding: 'utf8';
  }): string;
}>('node:child_process');

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.clearAllMocks();
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden'));
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each(['light', 'dark'] as const)(
  'ADR-005 R4.15 map background uses the %s theme and shows OSM attribution', async (scheme) => {
    const color = scheme === 'light' ? light : dark;
    jest.spyOn(appearance, 'useColorScheme').mockReturnValue(scheme);
    await render(<WalkMap points={[]} mode="detail" active />);
    expect(screen.getByTestId('walk-map')).toHaveStyle({ backgroundColor: color.bg });
    const style = jest.mocked(Map).mock.lastCall?.[0].mapStyle;
    if (style === undefined || typeof style === 'string') throw new Error('The map needs an inline raster style');
    expect(style.layers.find((layer) => layer.type === 'background'))
      .toMatchObject({ paint: { 'background-color': color.bg } });
    expect(screen.getByText(strings.walks.attribution)).toBeOnTheScreen();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

test('ADR-005 R4.15 mobile files contain no provider keys and the map uses keyless raster tiles', async () => {
  const root = resolve(__dirname, '../../../../../..');
  // Include tracked files and untracked additions, including config, assets,
  // manifests and tests. Git excludes installed/generated ignored files.
  const files = execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'apps/mobile',
  ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  expect(files.length).toBeGreaterThan(0);
  // Assemble the forbidden provider name so the audit scans its own source.
  const forbidden = new RegExp([
    ['GOOGLE', 'MAPS'].join('_'),
    '(?:your|insert|replace|put|enter)[ _-]*(?:api[ _-]*)?key(?:[ _-]*here)?',
    'api[ _-]*key[ _-]*(?:here|placeholder|goes[ _-]*here)',
    '<[ _-]*api[ _-]*key[ _-]*>',
  ].join('|'), 'i');
  expect(files.filter((file) => forbidden.test(readFileSync(resolve(root, file), 'utf8')))).toEqual([]);

  await render(<WalkMap points={[]} mode="detail" active />);
  expect(Map).toHaveBeenCalled();
  const map = jest.mocked(Map).mock.calls[0]?.[0];
  expect(map?.attribution).not.toBe(false);
  const style = map?.mapStyle;
  expect(typeof style).toBe('object');
  if (style === undefined || typeof style === 'string') throw new Error('The map needs an inline raster style');
  const raster = Object.values(style.sources).filter((source) => source.type === 'raster');
  expect(raster).toHaveLength(1);
  expect(raster[0]).toMatchObject({ tiles: [WALK_TILE_URL], attribution: expect.stringContaining('OpenStreetMap') });
  expect(WALK_TILE_URL).toMatch(/^https:\/\//);
  expect(WALK_TILE_URL).not.toMatch(/[?&](?:key|token|access_token)=/i);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
