import { describe, expect, it } from 'vitest';
import {
  createAccumulator, currentSpeedMps, haversineM, movingSeconds, paceSecPerKm,
  routeForUpload, routePreview, simplifyRoute, type RoutePoint, type WalkPoint, type WalkSnapshot,
} from './walk';

// One degree on the equator of the Q-11 sphere, in metres.
const metresPerDegree = 111_194.92664455874;

function point(x: number, y = 0, t = 0, patch: Partial<WalkPoint> = {}): WalkPoint {
  return { lat: y / metresPerDegree, lon: x / metresPerDegree, t, acc: 5, paused: false, ...patch };
}

function accumulate(points: readonly WalkPoint[]): WalkSnapshot {
  const accumulator = createAccumulator();
  points.forEach((fix) => accumulator.add(fix));
  return accumulator.snapshot();
}

function segmentDistance(x: number, y: number, a: WalkPoint, b: WalkPoint): number {
  const ax = a.lon * metresPerDegree;
  const ay = a.lat * metresPerDegree;
  const dx = (b.lon - a.lon) * metresPerDegree;
  const dy = (b.lat - a.lat) * metresPerDegree;
  const fraction = dx === 0 && dy === 0 ? 0
    : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy);
}

describe('walk math', () => {
  it('WK-H1 measures two known pairs within half a percent', () => {
    const pairs = [
      { a: { lat: 51.5074, lon: -0.1278 }, b: { lat: 48.8566, lon: 2.3522 }, distance: 343_556 },
      { a: { lat: 40.7128, lon: -74.0060 }, b: { lat: 51.5074, lon: -0.1278 }, distance: 5_570_222 },
    ];
    for (const { a, b, distance } of pairs) {
      expect(Math.abs(haversineM(a, b) - distance) / distance).toBeLessThan(0.005);
      expect(haversineM(b, a)).toBeCloseTo(haversineM(a, b), 6);
    }
  });

  it('WK-H2 handles coincident, antipodal and antimeridian positions', () => {
    expect(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    expect(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20_015_086.796, 2);
    expect(haversineM({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 })).toBeCloseTo(222.39, 2);
  });

  it('WK-A1 starts empty and sums a ten-point track with ten metre steps', () => {
    expect(createAccumulator().snapshot()).toEqual({ distanceM: 0, countedPosition: null, pointCount: 0 });
    const fixes = Array.from({ length: 10 }, (_, index) => point(index * 10, 0, index * 3000));
    const result = accumulate(fixes);
    expect(result.distanceM).toBeCloseTo(90, 6);
    expect(result.countedPosition).toEqual(fixes[9]);
    expect(result.pointCount).toBe(10);
  });

  it('WK-A2 leaves the counted anchor in place for sub-five-metre fixes', () => {
    const anchor = point(0);
    const accumulator = createAccumulator();
    accumulator.add(anchor);
    accumulator.add(point(4.999));
    expect(accumulator.snapshot()).toEqual({ distanceM: 0, countedPosition: anchor, pointCount: 2 });
    const counted = point(5.001);
    accumulator.add(counted);
    expect(accumulator.snapshot().distanceM).toBeCloseTo(5.001, 6);
    expect(accumulator.snapshot().countedPosition).toEqual(counted);
    expect(accumulate([point(0), point(5)]).distanceM).toBeCloseTo(5, 6);
  });

  it('WK-A3 twenty jittering fixes around one spot add zero metres', () => {
    const fixes = [point(0), ...Array.from({ length: 20 }, (_, index) =>
      point(index % 2 === 0 ? 3 : -3, index % 3 === 0 ? 2 : -2, (index + 1) * 3000))];
    expect(accumulate(fixes)).toEqual({ distanceM: 0, countedPosition: fixes[0], pointCount: 21 });
  });

  it('WK-2 excludes a two-kilometre outlier from distance and uploaded route', () => {
    const clean = [point(0), point(10, 0, 3000), point(20, 0, 9000)];
    const noisy = [clean[0], clean[1], point(10, 2000, 6000, { acc: 500 }), clean[2]]
      .filter((fix) => fix !== undefined);
    expect(accumulate(noisy).distanceM).toBeCloseTo(accumulate(clean).distanceM, 6);
    expect(routeForUpload(noisy)).toEqual(routeForUpload(clean));
    expect(accumulate(noisy).countedPosition).toEqual(clean[2]);
    expect(accumulate(noisy).pointCount).toBe(4);
  });

  it('WK-2 accuracy above thirty never establishes or moves the anchor', () => {
    const accumulator = createAccumulator();
    accumulator.add(point(2000, 0, 0, { acc: 30.001 }));
    expect(accumulator.snapshot()).toEqual({ distanceM: 0, countedPosition: null, pointCount: 1 });
    const first = point(0, 0, 3000, { acc: 30 });
    accumulator.add(first);
    accumulator.add(point(2000, 0, 6000, { acc: 31 }));
    expect(accumulator.snapshot().countedPosition).toEqual(first);
    accumulator.add(point(10, 0, 9000, { acc: 30 }));
    expect(accumulator.snapshot().distanceM).toBeCloseTo(10, 6);
    expect(routeForUpload([first, point(10, 0, 9000, { acc: 30 })])).toHaveLength(2);
  });

  it('WK-A4 skips paused fixes and the segment spanning a pause', () => {
    const accumulator = createAccumulator();
    [point(0), point(10), point(1000, 0, 6000, { paused: true, acc: 500 })]
      .forEach((fix) => accumulator.add(fix));
    expect(accumulator.snapshot().distanceM).toBeCloseTo(10, 6);
    expect(accumulator.snapshot().countedPosition).toBeNull();
    accumulator.add(point(1500, 0, 9000, { acc: 500 }));
    accumulator.add(point(2000, 0, 12000));
    expect(accumulator.snapshot().distanceM).toBeCloseTo(10, 6);
    accumulator.add(point(2010, 0, 15000));
    expect(accumulator.snapshot().distanceM).toBeCloseTo(20, 6);
    expect(accumulator.snapshot().pointCount).toBe(6);
    expect(accumulate([point(0, 0, 0, { paused: true }), point(100)]).distanceM).toBe(0);
  });

  it('WK-A5 snapshots and added points cannot mutate accumulator state', () => {
    const accumulator = createAccumulator();
    const first = point(0);
    accumulator.add(first);
    first.lon = 100;
    const snapshot = accumulator.snapshot();
    expect(snapshot.countedPosition).toEqual(point(0));
    if (snapshot.countedPosition === null) throw new Error('Expected a counted position');
    snapshot.countedPosition.lon = 100;
    snapshot.distanceM = 999;
    accumulator.add(point(10));
    expect(accumulator.snapshot().distanceM).toBeCloseTo(10, 6);
  });

  it('WK-M1 subtracts paused milliseconds and clamps moving time at zero', () => {
    expect(movingSeconds(1000, 12500, 2000)).toBe(9.5);
    expect(movingSeconds(1000, 1000, 0)).toBe(0);
    expect(movingSeconds(1000, 2000, 3000)).toBe(0);
    expect(movingSeconds(2000, 1000, 0)).toBe(0);
  });

  it('WK-M2 returns no pace below half a metre per second or without moving time', () => {
    expect(paceSecPerKm(49.999, 100)).toBeNull();
    expect(paceSecPerKm(50, 100)).toBe(2000);
    expect(paceSecPerKm(1000, 300)).toBe(300);
    expect(paceSecPerKm(0, 100)).toBeNull();
    expect(paceSecPerKm(0, 0)).toBeNull();
    expect(paceSecPerKm(100, 0)).toBeNull();
  });

  it('WK-S4 returns zero for standing jitter alternating two metres either side', () => {
    const fixes = [point(-2, 0, 0), point(2, 0, 3000), point(-2, 0, 6000), point(2, 0, 9000)];
    expect(currentSpeedMps(fixes)).toBe(0);
  });

  it('WK-S1 measures displacement over the inclusive last ten seconds of good fixes', () => {
    const fixes = [point(-1000, 0, 0), point(0, 0, 1000), point(10, 0, 6000),
      point(5000, 0, 8000, { acc: 31 }), point(10, 10, 11000)];
    expect(currentSpeedMps(fixes)).toBeCloseTo(Math.sqrt(200) / 10, 6);
    expect(currentSpeedMps([point(0, 0, 0), point(20, 0, 10001)])).toBe(0);
    expect(currentSpeedMps([point(0, 0, 0), point(20, 0, 10000, { acc: 30 })])).toBeCloseTo(2, 6);
    expect(currentSpeedMps([point(0), point(6, 0, 3000), point(12, 0, 6000), point(18, 0, 9000)]))
      .toBeCloseTo(2, 6);
    expect(currentSpeedMps([point(0), point(4.999, 0, 3000)])).toBe(0);
    expect(currentSpeedMps([point(0), point(5, 0, 3000)])).toBeCloseTo(5 / 3, 6);
  });

  it('WK-S2 returns zero for insufficient, stale, paused or same-time samples', () => {
    for (const fixes of [[], [point(0)], [point(0), point(10)],
      [point(0), point(10, 0, 3000, { acc: 500 })],
      [point(0), point(10, 0, 11000, { acc: 500 })],
      [point(0), point(10, 0, 3000, { paused: true })]]) {
      expect(currentSpeedMps(fixes)).toBe(0);
    }
    expect(currentSpeedMps([point(0), point(0, 0, 3000)])).toBe(0);
  });

  it('WK-S3 excludes speed segments spanning a pause', () => {
    const fixes = [point(0), point(1000, 0, 3000, { paused: true }),
      point(2000, 0, 6000), point(2006, 0, 9000)];
    expect(currentSpeedMps(fixes)).toBeCloseTo(2, 6);
  });

  it('WK-3 simplifies two thousand straight-ish fixes below two hundred within five metres', () => {
    const fixes = Array.from({ length: 2000 }, (_, index) => point(index * 2, Math.sin(index / 8) * 2, index * 3000));
    const result = simplifyRoute(fixes, 5);
    expect(result.length).toBeLessThan(200);
    expect(result[0]).toEqual(fixes[0]);
    expect(result.at(-1)).toEqual(fixes.at(-1));
    for (const fix of fixes) {
      const distances = result.slice(1).map((end, index) => {
        const start = result[index];
        if (start === undefined) throw new Error('Expected a segment start');
        return segmentDistance(fix.lon * metresPerDegree, fix.lat * metresPerDegree, start, end);
      });
      expect(Math.min(...distances)).toBeLessThanOrEqual(5);
    }
    expect(routeForUpload(fixes)).toEqual(result.map((fix) => [fix.lat, fix.lon, fix.t, fix.acc]));
  });

  it('WK-3 preserves turns outside tolerance and simplifies each resulting segment', () => {
    const fixes = [point(0), point(10), point(20), point(20, 10), point(20, 20), point(30, 20), point(40, 20)];
    expect(simplifyRoute(fixes, 5)).toEqual([fixes[0], fixes[2], fixes[4], fixes[6]]);
    expect(simplifyRoute([point(0), point(10, 4.999), point(20)], 5)).toEqual([point(0), point(20)]);
    expect(simplifyRoute([point(0), point(10, 5.001), point(20)], 5)).toHaveLength(3);
  });

  it('WK-3 projects around the first latitude and measures distance to finite segments', () => {
    const atSixty = [
      { ...point(0), lat: 60 },
      { ...point(0), lat: 60 + 10 / metresPerDegree, lon: 8 / metresPerDegree },
      { ...point(0), lat: 60 + 20 / metresPerDegree },
    ];
    expect(simplifyRoute(atSixty, 5)).toEqual([atSixty[0], atSixty[2]]);
    // The middle point lies on the infinite line, but beyond its segment.
    const backtrack = [point(0), point(30), point(10)];
    expect(simplifyRoute(backtrack, 5)).toEqual(backtrack);
    const loop = [point(0), point(20), point(0)];
    expect(simplifyRoute(loop, 5)).toEqual(loop);
    expect(simplifyRoute([point(0), point(0), point(0)], 5)).toEqual([point(0), point(0)]);
  });

  it('WK-3 preserves short routes and input metadata without mutation', () => {
    for (const fixes of [[], [point(0)], [point(0), point(10)]]) {
      expect(simplifyRoute(fixes, 5)).toEqual(fixes);
    }
    const fixes = [point(0, 0, 1000), point(10, 20, 2000, { acc: 20 }), point(20, 0, 3000)];
    const before = structuredClone(fixes);
    expect(simplifyRoute(fixes, 5)).toEqual(before);
    expect(fixes).toEqual(before);
    expect(simplifyRoute([point(0), point(10, 0.1), point(20)], 0)).toHaveLength(3);
  });

  it('WK-U1 filters inaccurate and paused fixes before simplifying and encoding upload tuples', () => {
    const fixes = [point(-2000, 0, 0, { acc: 500 }), point(0, 0, 1000, { acc: 30 }),
      point(10, 0, 2000), point(10, 2000, 3000, { paused: true }), point(20, 0, 4000),
      point(3000, 0, 5000, { acc: 31 })];
    const before = structuredClone(fixes);
    expect(routeForUpload(fixes)).toEqual([[0, 0, 1000, 30], [0, 20 / metresPerDegree, 4000, 5]]);
    expect(fixes).toEqual(before);
    expect(routeForUpload([])).toEqual([]);
    expect(routeForUpload([point(0, 0, 0, { paused: true })])).toEqual([]);
    expect(routeForUpload([point(0, 0, 1000)])).toEqual([[0, 0, 1000, 5]]);
  });

  it('WK-P1 previews at most thirty-two pairs while keeping both endpoints', () => {
    const route: RoutePoint[] = Array.from({ length: 100 }, (_, index) => [index / 1000, -index / 1000, index * 3000, 5]);
    const before = structuredClone(route);
    const preview = routePreview(route);
    expect(preview).toHaveLength(32);
    expect(preview[0]).toEqual([0, -0]);
    expect(preview.at(-1)).toEqual([0.099, -0.099]);
    expect(preview.every((pair) => pair.length === 2)).toBe(true);
    expect(preview.map(([lat]) => lat)).toEqual([...preview.map(([lat]) => lat)].sort((a, b) => a - b));
    expect(new Set(preview.map(([lat]) => lat)).size).toBe(32);
    expect(route).toEqual(before);
    for (const length of [0, 1, 2, 31, 32, 33]) {
      const short = route.slice(0, length);
      const result = routePreview(short);
      expect(result).toHaveLength(Math.min(32, length));
      if (length <= 32) expect(result).toEqual(short.map(([lat, lon]) => [lat, lon]));
      if (length > 0) expect(result.at(-1)).toEqual([short.at(-1)?.[0], short.at(-1)?.[1]]);
    }
  });
});
