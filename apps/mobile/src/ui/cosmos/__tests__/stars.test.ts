import { generateStars } from '../stars';

test('generateStars is deterministic for a seed and changes the sky for another seed', () => {
  const stars = generateStars(42, 120, 360, 800);
  expect(stars).toHaveLength(120);
  expect(generateStars(42, 120, 360, 800)).toEqual(stars);
  expect(generateStars(43, 120, 360, 800)).not.toEqual(stars);
});

test.each([60, 120])('generateStars splits %s stars 50/30/20 across three layers', (count) => {
  const stars = generateStars(42, count, 360, 240);
  expect(stars).toHaveLength(count);
  expect([0, 1, 2].map((layer) => stars.filter((star) => star.layer === layer).length))
    .toEqual([count * 0.5, count * 0.3, count * 0.2]);
});

test.each([0, 42, 4294967295])('generateStars seed %s keeps every star inside the bounds with valid radii and opacity', (seed) => {
  const stars = generateStars(seed, 120, 360, 800);
  expect(stars).toHaveLength(120);
  for (const star of stars) {
    expect(star.x).toBeGreaterThanOrEqual(0);
    expect(star.x).toBeLessThan(360);
    expect(star.y).toBeGreaterThanOrEqual(0);
    expect(star.y).toBeLessThan(800);
    expect(star.r).toBeGreaterThanOrEqual(0.6);
    expect(star.r).toBeLessThanOrEqual(1.8);
    expect(star.opacity).toBeGreaterThanOrEqual(0);
    expect(star.opacity).toBeLessThanOrEqual(1);
    expect([0, 1, 2]).toContain(star.layer);
  }
});
