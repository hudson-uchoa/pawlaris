import { starTints } from '../../tokens/cosmos';
import { generateSky, generateSkyEventSchedule, type SkyOptions } from '../sky';

test.each(['band', 'full'] as const)('06 §4.1 generateSky is deterministic and bounded for %s density', (density) => {
  const options: SkyOptions = { width: 360, height: 800, density };
  const sky = generateSky(42, options);
  expect(generateSky(42, options)).toEqual(sky);
  expect(generateSky(43, options)).not.toEqual(sky);
  expect(sky.stars).toHaveLength(density === 'full' ? 160 : 70);
  expect(sky.planets).toHaveLength(density === 'full' ? 2 : 1);
  expect(sky.dust).toHaveLength(density === 'full' ? 300 : 0);
  for (const point of [...sky.stars, ...sky.planets, ...sky.dust]) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThan(options.width);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThan(options.height);
  }
  expect(sky.band.angle).toBeGreaterThanOrEqual(20);
  expect(sky.band.angle).toBeLessThanOrEqual(35);
  expect(sky.band.width).toBeGreaterThan(0);
  expect(Number.isFinite(sky.band.offset)).toBe(true);
  for (const star of sky.stars) {
    expect([1, 2, 3, 4, 5, 6]).toContain(star.magnitude);
    expect(starTints).toContain(star.tint);
    expect(star.period).toBeGreaterThanOrEqual(1800);
    expect(star.period).toBeLessThanOrEqual(6000);
    expect(star.phase).toBeGreaterThanOrEqual(0);
    expect(star.phase).toBeLessThan(1);
  }
  for (const planet of sky.planets) {
    expect(planet.radius).toBeGreaterThanOrEqual(1.6);
    expect(planet.radius).toBeLessThanOrEqual(2.4);
  }
  for (const dust of sky.dust) {
    expect(dust.alpha).toBeGreaterThanOrEqual(0.06);
    expect(dust.alpha).toBeLessThanOrEqual(0.15);
  }
});

test('06 §4.1 magnitude and tint weights match within three points over 2,000 stars', () => {
  const stars = Array.from({ length: 13 }, (_, seed) =>
    generateSky(seed, { width: 360, height: 800, density: 'full' }).stars).flat().slice(0, 2000);
  expect(stars).toHaveLength(2000);
  const magnitudeWeights = [1, 3, 8, 18, 30, 40];
  const tintWeights = [15, 45, 25, 10, 5];
  magnitudeWeights.forEach((weight, index) => {
    const percent = stars.filter((star) => star.magnitude === index + 1).length / stars.length * 100;
    expect(Math.abs(percent - weight)).toBeLessThanOrEqual(3);
  });
  tintWeights.forEach((weight, index) => {
    const percent = stars.filter((star) => star.tint === starTints[index]).length / stars.length * 100;
    expect(Math.abs(percent - weight)).toBeLessThanOrEqual(3);
  });
});

test('06 §4.1 stars of the same magnitude have different periods or phases', () => {
  const { stars } = generateSky(42, { width: 360, height: 800, density: 'full' });
  let pairs = 0;
  stars.forEach((star, index) => {
    for (const other of stars.slice(index + 1)) {
      if (other.magnitude !== star.magnitude) continue;
      pairs += 1;
      expect(star.period !== other.period || star.phase !== other.phase).toBe(true);
    }
  });
  expect(pairs).toBeGreaterThan(0);
});

test('06 §4.1 meteor and satellite schedules are seeded and stay in their interval ranges', () => {
  const schedule = generateSkyEventSchedule(42, 100);
  expect(generateSkyEventSchedule(42, 100)).toEqual(schedule);
  expect(generateSkyEventSchedule(43, 100)).not.toEqual(schedule);
  for (const [times, minimum, maximum] of [
    [schedule.meteors, 18000, 45000], [schedule.satellites, 60000, 120000],
  ] as const) {
    expect(times).toHaveLength(100);
    let previous = 0;
    for (const time of times) {
      expect(time - previous).toBeGreaterThanOrEqual(minimum);
      expect(time - previous).toBeLessThanOrEqual(maximum);
      previous = time;
    }
  }
});
