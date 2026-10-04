export type Position = { lat: number; lon: number };
export type WalkPoint = Position & { t: number; acc: number; paused: boolean };
export type RoutePoint = [lat: number, lon: number, t: number, acc: number];
export type WalkSnapshot = {
  distanceM: number;
  countedPosition: WalkPoint | null;
  pointCount: number;
};
export type WalkAccumulator = {
  add(point: WalkPoint): void;
  snapshot(): WalkSnapshot;
};

// Q-11: spherical metres, epoch-millisecond timestamps and fractional seconds.
const earthRadiusM = 6_371_000;
const radiansPerDegree = Math.PI / 180;

export function haversineM(a: Position, b: Position): number {
  const latDelta = (b.lat - a.lat) * radiansPerDegree;
  const lonDelta = (b.lon - a.lon) * radiansPerDegree;
  const haversine = Math.sin(latDelta / 2) ** 2
    + Math.cos(a.lat * radiansPerDegree) * Math.cos(b.lat * radiansPerDegree)
      * Math.sin(lonDelta / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

export function createAccumulator(): WalkAccumulator {
  let distanceM = 0;
  let countedPosition: WalkPoint | null = null;
  let pointCount = 0;
  return {
    add(point) {
      // Q-11: count every local fix, independently of distance eligibility.
      pointCount += 1;
      if (point.paused) {
        countedPosition = null;
        return;
      }
      if (point.acc > 30) return;
      if (countedPosition === null) {
        countedPosition = { ...point };
        return;
      }
      const segmentM = haversineM(countedPosition, point);
      // Allow floating-point roundoff at the inclusive five-metre boundary.
      if (segmentM >= 5 - 5 * Number.EPSILON) {
        distanceM += segmentM;
        countedPosition = { ...point };
      }
    },
    snapshot() {
      return { distanceM, pointCount, countedPosition: countedPosition === null ? null : { ...countedPosition } };
    },
  };
}

export function movingSeconds(startedAt: number, now: number, pausedMs: number): number {
  return Math.max(0, now - startedAt - pausedMs) / 1000;
}

export function paceSecPerKm(distanceM: number, movingS: number): number | null {
  if (movingS <= 0 || distanceM / movingS < 0.5) return null;
  return movingS * 1000 / distanceM;
}

export function currentSpeedMps(points: readonly WalkPoint[]): number {
  const latest = points.at(-1);
  if (latest === undefined) return 0;
  // Q-11: anchor the window to the latest input, not a stale good fix.
  const cutoff = latest.t - 10_000;
  let newestGood: WalkPoint | null = null;
  let previous: WalkPoint | null = null;
  let distanceM = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point === undefined) continue;
    if (point.t < cutoff || point.paused) break;
    if (point.acc > 30) continue;
    if (previous !== null) distanceM += haversineM(point, previous);
    newestGood ??= point;
    previous = point;
  }
  if (newestGood === null || previous === null || newestGood.t <= previous.t) return 0;
  return distanceM * 1000 / (newestGood.t - previous.t);
}

type ProjectedPoint = { x: number; y: number };

function segmentDistanceSquared(point: ProjectedPoint, start: ProjectedPoint, end: ProjectedPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return (point.x - start.x - fraction * dx) ** 2 + (point.y - start.y - fraction * dy) ** 2;
}

export function simplifyRoute(points: readonly WalkPoint[], toleranceM: number): WalkPoint[] {
  const origin = points[0];
  if (origin === undefined || points.length <= 2) return [...points];
  const longitudeScale = earthRadiusM * radiansPerDegree * Math.cos(origin.lat * radiansPerDegree);
  const latitudeScale = earthRadiusM * radiansPerDegree;
  const projected = points.map((point) => ({
    x: (point.lon - origin.lon) * longitudeScale,
    y: (point.lat - origin.lat) * latitudeScale,
  }));
  const kept = new Set([0, points.length - 1]);
  // Iterative Douglas–Peucker avoids consuming the JS call stack on long routes.
  const segments: [number, number][] = [[0, points.length - 1]];
  for (let segment = segments.pop(); segment !== undefined; segment = segments.pop()) {
    const [startIndex, endIndex] = segment;
    const start = projected[startIndex];
    const end = projected[endIndex];
    if (start === undefined || end === undefined) continue;
    let farthestIndex: number | null = null;
    let farthestSquared = toleranceM * toleranceM;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = projected[index];
      if (point === undefined) continue;
      const distanceSquared = segmentDistanceSquared(point, start, end);
      if (distanceSquared > farthestSquared) {
        farthestSquared = distanceSquared;
        farthestIndex = index;
      }
    }
    if (farthestIndex !== null) {
      kept.add(farthestIndex);
      segments.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  return points.filter((_, index) => kept.has(index));
}

export function routeForUpload(points: readonly WalkPoint[]): RoutePoint[] {
  return simplifyRoute(points.filter((point) => point.acc <= 30 && !point.paused), 5)
    .map((point) => [point.lat, point.lon, point.t, point.acc]);
}

export function routePreview(points: readonly RoutePoint[]): [lat: number, lon: number][] {
  if (points.length <= 32) return points.map(([lat, lon]) => [lat, lon]);
  // Q-11: evenly sample the saved line; include the first and last pair.
  const preview: [number, number][] = [];
  for (let index = 0; index < 32; index += 1) {
    const point = points[Math.round(index * (points.length - 1) / 31)];
    if (point !== undefined) preview.push([point[0], point[1]]);
  }
  return preview;
}
