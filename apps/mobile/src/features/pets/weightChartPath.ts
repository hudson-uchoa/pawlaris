import type { WeightEntry } from '@pawlaris/shared';

export type WeightChartEntry = Pick<WeightEntry, 'measured_at' | 'weight_kg'>;

export type WeightChartPoint = { x: number; y: number; index: number; distance: number };
export type WeightChartGeometry = { path: string; points: WeightChartPoint[]; length: number };

const paddingRatio = 0.1;
const lengthSamples = 32;

/** Coordinates and cumulative curve lengths, shared by drawing and scrubbing. */
export function weightChartGeometry(
  entries: readonly WeightChartEntry[], width: number, height: number,
): WeightChartGeometry {
  const ordered = entries.map((entry, index) => ({ ...entry, index, time: Date.parse(entry.measured_at) }))
    .sort((a, b) => a.time - b.time);
  const first = ordered[0];
  const last = ordered.at(-1);
  if (first === undefined || last === undefined || width <= 0 || height <= 0) {
    return { path: '', points: [], length: 0 };
  }
  const minimum = ordered.reduce((value, entry) => Math.min(value, entry.weight_kg), first.weight_kg);
  const maximum = ordered.reduce((value, entry) => Math.max(value, entry.weight_kg), first.weight_kg);
  const range = maximum - minimum;
  const span = last.time - first.time;
  const points = ordered.map((entry): WeightChartPoint => ({
    x: span === 0 ? width / 2 : (entry.time - first.time) / span * width,
    y: range === 0 ? height / 2
      : (maximum + range * paddingRatio - entry.weight_kg) / (range * (1 + 2 * paddingRatio)) * height,
    index: entry.index, distance: 0,
  }));
  const slopes = points.slice(1).map((point, index) => {
    const previous = points[index];
    return previous === undefined || point.x === previous.x ? 0 : (point.y - previous.y) / (point.x - previous.x);
  });
  const tangents = points.map((_point, index) => {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  // Fritsch–Carlson: flat segments have zero tangents; limit each tangent pair
  // to the radius-three circle to preserve monotonicity between measurements.
  slopes.forEach((slope, index) => {
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
    } else {
      const a = (tangents[index] ?? 0) / slope;
      const b = (tangents[index + 1] ?? 0) / slope;
      const radius = Math.hypot(a, b);
      if (radius > 3) {
        tangents[index] = 3 * a / radius * slope;
        tangents[index + 1] = 3 * b / radius * slope;
      }
    }
  });
  const start = points[0];
  if (start === undefined) return { path: '', points, length: 0 };
  let path = `M${start.x} ${start.y}`;
  let length = 0;
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    if (previous === undefined) return;
    const third = (point.x - previous.x) / 3;
    if (points.length === 2 || third === 0) {
      path += ` L${point.x} ${point.y}`;
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    } else {
      const x1 = previous.x + third;
      const y1 = previous.y + third * (tangents[index] ?? 0);
      const x2 = point.x - third;
      const y2 = point.y - third * (tangents[index + 1] ?? 0);
      path += ` C${x1} ${y1} ${x2} ${y2} ${point.x} ${point.y}`;
      // Subpixel arc-length approximation for the dash and each star's reveal.
      let x = previous.x;
      let y = previous.y;
      for (let step = 1; step <= lengthSamples; step += 1) {
        const t = step / lengthSamples;
        const u = 1 - t;
        const nextX = previous.x + (point.x - previous.x) * t;
        const nextY = u ** 3 * previous.y + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * point.y;
        length += Math.hypot(nextX - x, nextY - y);
        x = nextX;
        y = nextY;
      }
    }
    point.distance = length;
  });
  return { path, points, length };
}

/** Absolute SVG path, using M, L and C commands. */
export function weightChartPath(entries: readonly WeightChartEntry[], width: number, height: number): string {
  return weightChartGeometry(entries, width, height).path;
}
