import { generateSky, starAlpha, starDepth, starRadius, type Magnitude } from '../sky';

test('generateSky is deterministic for a seed and changes the sky for another seed', () => {
  const options = { width: 360, height: 800, density: 'full' } as const;
  const sky = generateSky(42, options);
  expect(sky.stars).toHaveLength(160);
  expect(generateSky(42, options)).toEqual(sky);
  expect(generateSky(43, options)).not.toEqual(sky);
});

test.each(['band', 'full'] as const)('06 section 4.1 generates the specified %s count', (density) => {
  const sky = generateSky(42, { width: 360, height: 240, density });
  expect(sky.stars).toHaveLength(density === 'band' ? 70 : 160);
  expect(sky.planets).toHaveLength(density === 'band' ? 1 : 2);
});

test.each([0, 42, 4294967295])('generateSky seed %s keeps every star inside bounds with valid magnitude paint', (seed) => {
  const { stars } = generateSky(seed, { width: 360, height: 800, density: 'full' });
  expect(stars).toHaveLength(160);
  for (const star of stars) {
    expect(star.x).toBeGreaterThanOrEqual(0);
    expect(star.x).toBeLessThan(360);
    expect(star.y).toBeGreaterThanOrEqual(0);
    expect(star.y).toBeLessThan(800);
    expect(starRadius(star.magnitude)).toBeGreaterThanOrEqual(0.5);
    expect(starRadius(star.magnitude)).toBeLessThanOrEqual(2.25);
    expect(starAlpha(star, 0)).toBeGreaterThanOrEqual(0);
    expect(starAlpha(star, 0)).toBeLessThanOrEqual(1);
    expect([1, 2, 3, 4, 5, 6]).toContain(star.magnitude);
  }
});

test('06 section 4.1 magnitude replaces the old layer paint and parallax table', () => {
  const magnitudes: Magnitude[] = [1, 2, 3, 4, 5, 6];
  const expected = [
    [2.25, 0.95, 0.16], [1.9, 0.81, 0.16], [1.55, 0.67, 0.08],
    [1.2, 0.53, 0.08], [0.85, 0.39, 0.04], [0.5, 0.25, 0.04],
  ];
  magnitudes.forEach((magnitude, index) => {
    const star = { x: 0, y: 0, magnitude, tint: '#FFFFFF', period: 2000, phase: 0.25 } as const;
    const actual = [starRadius(magnitude), starAlpha(star, 0), starDepth(magnitude)];
    actual.forEach((value, column) => expect(value).toBeCloseTo(expected[index]?.[column] ?? 0));
    const amplitude = magnitude <= 2 ? 0.15 : magnitude <= 4 ? 0.35 : 0.5;
    expect(starAlpha(star, 1000)).toBeCloseTo((expected[index]?.[1] ?? 0) * (1 - amplitude));
  });
});
