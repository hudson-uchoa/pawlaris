import { planetTints, starfield, starTints } from '../tokens/cosmos';
import { mulberry32 } from './random';

export type StarTint = typeof starTints[number];
export type PlanetTint = typeof planetTints[number];
export type Magnitude = 1 | 2 | 3 | 4 | 5 | 6;
export type SkyStar = {
  x: number;
  y: number;
  magnitude: Magnitude;
  tint: StarTint;
  /** Milliseconds per cycle; phase is a fraction of one cycle. */
  period: number;
  phase: number;
};
export type SkyPlanet = { x: number; y: number; radius: number; tint: PlanetTint };
export type Sky = {
  stars: SkyStar[];
  planets: SkyPlanet[];
  band: { angle: number; offset: number; width: number };
  dust: { x: number; y: number; alpha: number }[];
};
export type SkyOptions = { width: number; height: number; density: 'band' | 'full' };

export function starRadius(magnitude: Magnitude): number {
  'worklet';
  return starfield.radius.minimum + (6 - magnitude) * starfield.radius.step;
}

export function starAlpha(star: SkyStar, time: number): number {
  'worklet';
  const base = starfield.alpha.minimum + (6 - star.magnitude) * starfield.alpha.step;
  const amplitude = starfield.amplitude[star.magnitude <= 2 ? 0 : star.magnitude <= 4 ? 1 : 2];
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (time / star.period + star.phase));
  return base * (1 - amplitude + amplitude * wave);
}

export function starDepth(magnitude: Magnitude): number {
  'worklet';
  return starfield.parallax[magnitude <= 2 ? 0 : magnitude <= 4 ? 1 : 2];
}

function weightedIndex(sample: number, weights: readonly number[]): number {
  let cumulative = 0;
  for (const [index, weight] of weights.entries()) {
    cumulative += weight;
    if (sample * 100 < cumulative) return index;
  }
  return weights.length - 1;
}

export function generateSky(seed: number, { width, height, density }: SkyOptions): Sky {
  const next = mulberry32(seed);
  const range = (min: number, max: number): number => min + next() * (max - min);
  const stars = Array.from({ length: starfield.count[density] }, (): SkyStar => ({
    x: next() * width,
    y: next() * height,
    magnitude: (weightedIndex(next(), starfield.magnitudeWeights) + 1) as Magnitude,
    tint: starTints[weightedIndex(next(), starfield.tintWeights)] ?? starTints[1],
    period: range(...starfield.period),
    phase: next(),
  }));
  const band = { angle: range(...starfield.band.angle), offset: height * range(0.35, 0.65),
    width: Math.max(width, height) * starfield.band.width };
  const slope = Math.tan(band.angle * Math.PI / 180);
  const bandY = (x: number): number => band.offset + (x - width / 2) * slope;
  const boundY = (y: number): number => Math.max(0, Math.min(height * (1 - Number.EPSILON), y));
  const planets = Array.from({ length: density === 'full' ? 2 : 1 }, (): SkyPlanet => {
    const x = next() * width;
    return { x, y: boundY(bandY(x) + range(-0.1, 0.1) * band.width),
      radius: range(...starfield.planet.radius),
      tint: planetTints[Math.floor(next() * planetTints.length)] ?? planetTints[0] };
  });
  const dust = Array.from({ length: density === 'full' ? starfield.band.dustCount : 0 }, () => {
    const left = Math.max(0, width / 2 + (-band.offset - band.width / 2) / slope);
    const right = Math.min(width, width / 2 + (height - band.offset + band.width / 2) / slope);
    const x = range(left, right);
    // Intersect the band's vertical section with the canvas before sampling.
    const low = Math.max(0, Math.min(height, bandY(x) - band.width / 2));
    const high = Math.max(low, Math.min(height, bandY(x) + band.width / 2));
    return { x, y: boundY(range(low, high)), alpha: range(...starfield.band.dustAlpha) };
  });
  return { stars, planets, band, dust };
}

/** Q-52: cumulative mount-relative milliseconds, count events of each kind. */
export type SkyEventSchedule = { meteors: number[]; satellites: number[] };

export function generateSkyEventSchedule(seed: number, count: number): SkyEventSchedule {
  const next = mulberry32(seed);
  const times = ([minimum, maximum]: readonly [number, number]): number[] => {
    let elapsed = 0;
    return Array.from({ length: count }, () => {
      elapsed += minimum + next() * (maximum - minimum);
      return elapsed;
    });
  };
  return { meteors: times(starfield.meteor.interval), satellites: times(starfield.satellite.interval) };
}
