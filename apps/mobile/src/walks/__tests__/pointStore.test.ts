import { createAccumulator, type WalkAccumulator } from '@pawlaris/shared';
import { trackPoint, trackingStorage } from './trackingSupport';

let c: Awaited<ReturnType<typeof trackingStorage>>;
beforeEach(async () => { c = await trackingStorage(); });
afterEach(() => { c.driver.close(); });

test('WK-1 commits each fix before invoking the real accumulator', async () => {
  const real = createAccumulator();
  let aggregated = 0;
  const observing: WalkAccumulator = {
    add(point) {
      // A new native transaction cannot begin until the fix has committed.
      c.driver.run('BEGIN IMMEDIATE');
      c.driver.run('ROLLBACK');
      const rows = c.driver.all('SELECT * FROM walk_point WHERE walk_id = ?', ['walk']);
      expect(rows).toHaveLength(aggregated + 1);
      expect(c.walks.points('walk').at(-1)).toMatchObject(point);
      real.add(point);
      aggregated += 1;
    },
    snapshot: () => real.snapshot(),
  };
  for (let index = 0; index < 100; index += 1) {
    c.points.append('walk', trackPoint(c.clock.now(), index), observing);
    c.clock.advance(3000);
  }
  expect(aggregated).toBe(100);
  const reopened = await trackingStorage(c.driver.export());
  try {
    expect(reopened.walks.points('walk')).toHaveLength(100);
    expect(real.snapshot().pointCount).toBe(100);
  } finally { reopened.driver.close(); }
});

test('WK-1 rebuilds after point 60 and finishes within 1% of 100 uninterrupted fixes', async () => {
  const uninterrupted = createAccumulator();
  let live = createAccumulator();
  for (let index = 0; index < 60; index += 1) {
    const point = trackPoint(c.clock.now(), index);
    uninterrupted.add(point);
    c.points.append('walk', point, live);
    c.clock.advance(3000);
  }
  const image = c.driver.export();
  c.driver.close();
  c = await trackingStorage(image);
  // No accumulator or point-store instance from before the kill is reused.
  live = c.points.rebuild('walk');
  expect(c.points.read('walk').length).toBeGreaterThanOrEqual(59);
  expect(live.snapshot().pointCount).toBe(60);
  for (let index = 60; index < 100; index += 1) {
    const point = trackPoint(c.clock.now() + index * 3000, index);
    uninterrupted.add(point);
    c.points.append('walk', point, live);
  }
  expect(c.points.read('walk')).toHaveLength(100);
  const expected = uninterrupted.snapshot().distanceM;
  expect(expected).toBeGreaterThan(0);
  expect(Math.abs(live.snapshot().distanceM - expected) / expected).toBeLessThanOrEqual(0.01);
  expect(c.points.rebuild('walk').snapshot()).toEqual(live.snapshot());
});

test('R4.13 stores paused flags and rebuilds without bridging the paused segment', () => {
  const live = createAccumulator();
  const points = [trackPoint(c.clock.now()), trackPoint(c.clock.now() + 3000, 1, true),
    trackPoint(c.clock.now() + 6000, 100), trackPoint(c.clock.now() + 9000, 101)];
  for (const point of points) c.points.append('walk', point, live);
  expect(c.points.read('walk').map(({ paused }) => paused)).toEqual([false, true, false, false]);
  expect(c.driver.all('SELECT paused FROM walk_point ORDER BY seq'))
    .toEqual([{ paused: 0 }, { paused: 1 }, { paused: 0 }, { paused: 0 }]);
  expect(live.snapshot().distanceM).toBeGreaterThan(10);
  expect(live.snapshot().distanceM).toBeLessThan(12);
  expect(c.points.rebuild('walk').snapshot()).toEqual(live.snapshot());
});
