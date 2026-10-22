import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import config from '../app.config';
import { pawStar } from '../src/ui/cosmos/glyphs';
import { dark } from '../src/ui/tokens/color';

declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync(path: string): Uint8Array;
}>('node:fs');
const { resolve } = jest.requireActual<{ resolve(...paths: string[]): string }>('node:path');

function asset(file: string) {
  const bytes = readFileSync(resolve(__dirname, '../assets', file));
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (image === null) throw new Error(`Cannot decode ${file}`);
  const pixels = image.readPixels(0, 0, {
    width: image.width(), height: image.height(),
    colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul,
  });
  if (pixels === null) throw new Error(`Cannot read ${file}`);
  return {
    bytes, image, pixels,
    pixel(x: number, y: number) {
      const offset = (Math.round(y) * image.width() + Math.round(x)) * 4;
      return Array.from(pixels.slice(offset, offset + 4));
    },
  };
}

const files = ['icon.png', 'adaptive-foreground.png', 'adaptive-background.png',
  'adaptive-monochrome.png', 'splash-icon.png'] as const;

test.each(files)('P7-3 06 section 4.11 %s is a decodable square 1024 px PNG', (file) => {
  const { bytes, image } = asset(file);
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([image.width(), image.height()]).toEqual([1024, 1024]);
});

test('P7-3 06 section 4.11 config selects only the approved icon and splash assets', () => {
  expect(config.icon).toBe('./assets/icon.png');
  expect(config.android?.adaptiveIcon).toEqual({
    foregroundImage: './assets/adaptive-foreground.png',
    backgroundImage: './assets/adaptive-background.png',
    monochromeImage: './assets/adaptive-monochrome.png',
  });
  expect(config.plugins?.filter((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'))
    .toEqual([['expo-splash-screen', {
      image: './assets/splash-icon.png', backgroundColor: dark.bg,
      dark: { image: './assets/splash-icon.png', backgroundColor: dark.bg },
    }]]);
});

function near(actual: number[], expected: number[], tolerance = 4) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((channel, index) => expect(Math.abs(channel - (expected[index] ?? 0)))
    .toBeLessThanOrEqual(tolerance));
}

function rgb(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

// These transforms are the master icon's placement, with the adaptive
// foreground reduced to 0.44 to remain inside Android's safe zone.
test.each([
  ['icon.png', 0.66], ['adaptive-foreground.png', 0.44],
  // The splash export already uses 0.8; the spec requires the mark alone,
  // without prescribing a splash scale.
  ['adaptive-monochrome.png', 0.44], ['splash-icon.png', 0.8],
] as const)('P7-3 06 section 4.11 %s preserves the pad, four stars and Polaris at scale %s', (file, scale) => {
  const { pixel } = asset(file);
  const mono = file === 'adaptive-monochrome.png';
  function at(x: number, y: number) {
    return pixel(2 * (256 + scale * (x - 256)), 2 * (258 + scale * (y - 252)));
  }
  for (const toe of pawStar.toes) {
    const angle = toe.rotation * Math.PI / 180;
    // Sample the centre and all four arms, including Polaris's longer arms.
    for (const [dx, dy] of [[0, 0], [0, -0.7], [0.7, 0], [0, 0.7], [-0.7, 0]]) {
      const x = toe.x + toe.radius * ((dx ?? 0) * Math.cos(angle) - (dy ?? 0) * Math.sin(angle));
      const y = toe.y + toe.radius * ((dx ?? 0) * Math.sin(angle) + (dy ?? 0) * Math.cos(angle));
      near(at(x, y), mono ? [255, 255, 255, 255] : [...rgb(dark.star), 255]);
    }
  }
  // Interior pad samples pin its vertical gradient and exclude a gold pad.
  for (const y of [280, 340, 400]) {
    const fraction = (y - 262) / (430 - 262);
    const bottom = rgb(dark.padBottom);
    const expected = rgb(dark.padTop).map((top, index) => top + fraction * ((bottom[index] ?? 0) - top));
    near(at(256, y), mono ? [255, 255, 255, 255] : [...expected, 255]);
  }
});

test.each(['adaptive-foreground.png', 'adaptive-monochrome.png', 'splash-icon.png'])(
  'P7-3 06 section 4.11 %s has a transparent surround without a photo or shadow', (file) => {
    const { pixel } = asset(file);
    for (let offset = 0; offset < 1024; offset += 16) {
      for (const [x, y] of [[offset, 0], [offset, 1023], [0, offset], [1023, offset]]) {
        expect(pixel(x ?? 0, y ?? 0)[3]).toBe(0);
      }
    }
  },
);

test.each(['adaptive-foreground.png', 'splash-icon.png'] as const)(
  'P7-3 06 section 4.11 %s has the Polaris glow fading from half alpha to transparent', (file) => {
    const { pixel } = asset(file);
    const scale = file === 'splash-icon.png' ? 0.8 : 0.44;
    // These points avoid all five solid paths and sample the radial fade.
    for (const [x, y] of [[380, 100], [410, 100], [430, 100], [450, 100]]) {
      if (x === undefined || y === undefined) throw new Error('Missing glow sample');
      const alpha = Math.max(0, 0.5 * (1 - Math.hypot(x - 330, y - 150) / 118));
      const actual = pixel(2 * (256 + scale * (x - 256)), 2 * (258 + scale * (y - 252)));
      expect(Math.abs((actual[3] ?? 0) - 255 * alpha)).toBeLessThanOrEqual(3);
    }
  },
);

test('P7-3 06 section 4.11 monochrome uses only white with no glow and fits the safe zone', () => {
  const { pixels, pixel } = asset('adaptive-monochrome.png');
  let nonWhite = 0;
  let outsideSafeZone = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) > 0) {
      if (pixels[offset] !== 255 || pixels[offset + 1] !== 255 || pixels[offset + 2] !== 255) nonWhite += 1;
      const x = (offset / 4) % 1024;
      const y = Math.floor(offset / 4 / 1024);
      if (Math.hypot(x - 512, y - 512) >= 1024 / 3) outsideSafeZone += 1;
    }
  }
  expect(nonWhite).toBe(0);
  expect(outsideSafeZone).toBe(0);
  // Outside the Polaris sparkle but inside its glow circle.
  expect(pixel(2 * (256 + 0.44 * (380 - 256)), 2 * (258 + 0.44 * (100 - 252)))[3]).toBe(0);
});

test.each([
  ['adaptive-foreground.png', 0.44], ['adaptive-monochrome.png', 0.44], ['splash-icon.png', 0.8],
] as const)('P7-3 06 section 4.11 %s has only the master silhouette and its permitted glow', (file, scale) => {
  const { pixel } = asset(file);
  const pad = Skia.Path.MakeFromSVGString(pawStar.pad);
  const toes = pawStar.toes.map((toe) => ({ ...toe, shape: Skia.Path.MakeFromSVGString(toe.path) }));
  if (pad === null || toes.some((toe) => toe.shape === null)) throw new Error('Invalid master geometry');
  function solid(x: number, y: number) {
    return pad?.contains(x, y) === true || toes.some((toe) => {
      const angle = -toe.rotation * Math.PI / 180;
      return toe.shape?.contains(toe.x + (x - toe.x) * Math.cos(angle) - (y - toe.y) * Math.sin(angle),
        toe.y + (x - toe.x) * Math.sin(angle) + (y - toe.y) * Math.cos(angle)) === true;
    });
  }
  const problems: { x: number; y: number; actual: number; expected: number }[] = [];
  for (let py = 0; py < 1024; py += 8) {
    for (let px = 0; px < 1024; px += 8) {
      const x = ((px + 0.5) / 2 - 256) / scale + 256;
      const y = ((py + 0.5) / 2 - 258) / scale + 252;
      const filled = solid(x, y);
      // Ignore only the one-pixel antialias boundary of the exact paths.
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx = 0, dy = 0]) => solid(x + dx / scale, y + dy / scale) !== filled)) continue;
      const alpha = filled ? 1 : file === 'adaptive-monochrome.png' ? 0
        : Math.max(0, 0.5 * (1 - Math.hypot(x - 330, y - 150) / 118));
      const actual = pixel(px, py)[3] ?? 0;
      if (Math.abs(actual - 255 * alpha) > 3 && problems.length < 10) {
        problems.push({ x: px, y: py, actual, expected: 255 * alpha });
      }
    }
  }
  // No extra signature, photograph, stroke, shadow or overall tilt can
  // introduce opaque pixels outside the five paths and radial glow.
  expect(problems).toEqual([]);
});

test.each(['icon.png', 'adaptive-background.png'])(
  'P7-3 06 section 4.11 %s preserves its master sky: nine icon stars or a plain adaptive background', (file) => {
    const { pixel } = asset(file);
    // All nine circles, including their individual radii and opacities,
    // are taken from the read-only icon master, rather than new artwork.
    const stars = [[58, 70, 3, 0.7], [452, 96, 2.5, 0.6], [96, 420, 2, 0.5],
      [430, 400, 3, 0.65], [250, 44, 2, 0.5], [476, 250, 2, 0.45],
      [36, 250, 2.5, 0.5], [380, 470, 2, 0.4], [150, 480, 2.5, 0.45]];
    function sky(x: number, y: number) {
      const fraction = Math.min(1, Math.hypot(x - 256, y - 512 * 0.28) / (512 * 0.85));
      return [27, 33, 87].map((channel, index) => channel + fraction * (([9, 11, 26][index] ?? 0) - channel));
    }
    if (file === 'icon.png') {
      for (const [x = 0, y = 0, radius = 0, opacity = 0] of stars) {
        near(pixel(2 * x, 2 * y), [...sky(x, y).map((channel) => channel * (1 - opacity) + 255 * opacity), 255]);
        near(pixel(2 * (x + radius + 2), 2 * y), [...sky(x + radius + 2, y), 255]);
      }
    }
    // The adaptive background is the sky alone, without a second mark.
    if (file === 'adaptive-background.png') {
      for (let y = 0; y < 512; y += 8) {
        for (let x = 0; x < 512; x += 8) {
          near(pixel(2 * x, 2 * y), [...sky(x, y), 255]);
        }
      }
    }
  },
);
