import type { planetTints, starTints } from '../tokens/cosmos';

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

export function generateSky(_seed: number, _options: SkyOptions): Sky {
  throw new Error('not implemented');
}

/** Q-52: cumulative mount-relative milliseconds, count events of each kind. */
export type SkyEventSchedule = { meteors: number[]; satellites: number[] };

export function generateSkyEventSchedule(_seed: number, _count: number): SkyEventSchedule {
  throw new Error('not implemented');
}
