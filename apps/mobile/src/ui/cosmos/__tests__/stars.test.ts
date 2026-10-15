import { generateStars, starLayers } from '../stars';

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

test.each([0, 1, 3, 9, 17])('Q-35 generateStars allocates the remainder of %s stars to the near layer', (count) => {
  const stars = generateStars(42, count, 360, 240);
  const far = Math.floor(count * 0.5);
  const middle = Math.floor(count * 0.3);
  expect(stars).toHaveLength(count);
  expect([0, 1, 2].map((layer) => stars.filter((star) => star.layer === layer).length))
    .toEqual([far, middle, count - far - middle]);
  expect(stars.map((star) => star.layer)).toEqual([
    ...Array<number>(far).fill(0), ...Array<number>(middle).fill(1), ...Array<number>(count - far - middle).fill(2),
  ]);
});

test('Q-35 starLayers preserves the specified radius, opacity and parallax table', () => {
  expect(starLayers.map(({ radius, opacity, parallax }) => [radius, opacity, parallax])).toEqual([
    [0.6, 0.35, 0.04], [1.2, 0.55, 0.08], [1.8, 0.8, 0.16],
  ]);
  const stars = generateStars(42, 60, 360, 240);
  for (const star of stars) {
    expect(star.r).toBe(starLayers[star.layer].radius);
    expect(star.opacity).toBe(starLayers[star.layer].opacity);
  }
});

test('Q-35 generateStars consumes mulberry32 for x then y with no layer draws', () => {
  expect(generateStars(42, 3, 1, 1).map(({ x, y }) => ({ x, y }))).toEqual([
    { x: 0.6011037519201636, y: 0.44829055899754167 },
    { x: 0.8524657934904099, y: 0.6697340414393693 },
    { x: 0.17481389874592423, y: 0.5265925421845168 },
  ]);
});
