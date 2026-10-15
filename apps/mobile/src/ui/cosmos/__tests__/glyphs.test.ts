import { Skia, type SkPath } from '@shopify/react-native-skia';
import { crescentPath, pawStar, sparklePath, starPath } from '../glyphs';

// Keep Node-only test utilities outside the app's ambient type libraries.
declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync: (path: string, encoding: 'utf8') => string;
}>('node:fs');
const { resolve } = jest.requireActual<{
  resolve: (...paths: string[]) => string;
}>('node:path');

function parsePath(svg: string): SkPath {
  const path = Skia.Path.MakeFromSVGString(svg);
  if (path === null) throw new Error('Invalid authored glyph path');
  return path;
}

test('Q-35 starPath is a closed ten-vertex polygon with alternating radii and an upward tip', () => {
  const path = parsePath(starPath(24, 32, 10));
  expect(path.countPoints()).toBe(10);
  expect(path.toSVGString().trim()).toMatch(/[zZ]$/);
  expect(path.getPoint(0).x).toBeCloseTo(24);
  expect(path.getPoint(0).y).toBeCloseTo(22);
  for (let index = 0; index < path.countPoints(); index += 1) {
    const point = path.getPoint(index);
    const dx = point.x - 24;
    const dy = point.y - 32;
    expect(Math.hypot(dx, dy)).toBeCloseTo(index % 2 === 0 ? 10 : 5, 4);
    const degrees = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;
    expect(degrees).toBeCloseTo(index * 36, 4);
  }
});

test('Q-35 crescentPath preserves the exact normalized path and its right-facing opening', () => {
  expect(crescentPath(0, 0, 1)).toBe('M0 -1 A1 1 0 1 0 0 1 A0.6 1 0 0 1 0 -1 Z');
  const path = parsePath(crescentPath(24, 32, 10));
  expect(path.toSVGString()).toBe(parsePath('M24 22 A10 10 0 1 0 24 42 A6 10 0 0 1 24 22 Z').toSVGString());
  expect(path.contains(15, 32)).toBe(true);
  expect(path.contains(24, 32)).toBe(false);
  expect(path.contains(30, 32)).toBe(false);
});

test('sparklePath preserves the four quadratic tips and the 0.3 R control geometry of 06 section 4.11', () => {
  const actual = parsePath(sparklePath(10, 20, 10));
  const expected = parsePath('M10 10 Q13 17 20 20 Q13 23 10 30 Q7 23 0 20 Q7 17 10 10 Z');
  expect(actual.toSVGString()).toBe(expected.toSVGString());
});

test.each(['paw-star.svg', 'paw-star-dawn.svg', 'paw-star-mono.svg'])('pawStar matches every path and toe rotation in the read-only %s master', (file) => {
  const master = readFileSync(resolve(__dirname, '../../../../../../spec/brand', file), 'utf8');
  const paths = [...master.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]);
  expect(paths).toHaveLength(5);
  expect([pawStar.pad, ...pawStar.toes.map((toe) => toe.path)].map((path) => parsePath(path).toSVGString()))
    .toEqual(paths.map((path) => {
      if (path === undefined) throw new Error('Missing master path');
      return parsePath(path).toSVGString();
    }));
  const rotations = [...master.matchAll(/transform="rotate\(([^)]+)\)"/g)].map((match) => match[1]);
  expect(pawStar.toes.map((toe) => `${toe.rotation} ${toe.x} ${toe.y}`)).toEqual(rotations);
});
