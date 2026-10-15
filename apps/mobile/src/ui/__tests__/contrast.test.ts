import { dark, identity, light } from '../tokens/color';
import { pairs, type ColorSource } from '../tokens/pairs';
import type { ThemeColors, ThemeScheme } from '../theme';

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected an opaque RGB colour: ${hex}`);
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function resolve(source: ColorSource, colors: ThemeColors, scheme: ThemeScheme): string {
  if (typeof source === 'string') return colors[source];
  const entry = identity.find((candidate) => candidate.name === source.identity);
  if (entry === undefined) throw new Error(`Unknown identity: ${source.identity}`);
  return entry[scheme];
}

test('P9 contrast: the registry contains semantic and all eight identity pairs', () => {
  expect(pairs.length).toBeGreaterThan(0);
  expect(new Set(pairs.map((pair) => pair.name)).size).toBe(pairs.length);
  expect(pairs.map((pair) => pair.name)).toEqual(expect.arrayContaining([
    'text/bg', 'text/surface', 'textMuted/surface', 'accent/accentSoft',
    'onAccent/accent', 'star/surface/graphic', 'danger/surface',
    ...identity.flatMap((entry) => [`${entry.name}/bg`, `${entry.name}/surface`, `onAccent/${entry.name}`]),
  ]));
});

describe.each(['light', 'dark'] as const)('P9 WCAG AA in %s', (scheme) => {
  const colors = scheme === 'light' ? light : dark;
  test.each(pairs)('$name ($kind)', ({ foreground, background, kind }) => {
    const a = luminance(resolve(foreground, colors, scheme));
    const b = luminance(resolve(background, colors, scheme));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(kind === 'text' ? 4.5 : 3);
  });
});
