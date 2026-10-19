import { weightChartPath, type WeightChartEntry } from '../weightChartPath';

function entries(weights: readonly number[]): WeightChartEntry[] {
  const days = [1, 2, 5, 8, 11, 12];
  return weights.map((weight_kg, index) => ({
    weight_kg, measured_at: `2026-10-${String(days[index]).padStart(2, '0')}T12:00:00Z`,
  }));
}

function commands(path: string) {
  return [...path.matchAll(/([MLC])([^MLC]*)/g)].map((match) => ({
    kind: match[1],
    values: (match[2] ?? '').trim().split(/[\s,]+/).map(Number),
  }));
}

test('R2.6 weightChartPath connects two measurements with a straight line', () => {
  const path = commands(weightChartPath(entries([2, 4]), 240, 120));
  expect(path.map((command) => command.kind)).toEqual(['M', 'L']);
  expect(path[0]?.values[0]).toBeCloseTo(0);
  expect(path[0]?.values[1]).toBeCloseTo(110);
  expect(path[1]?.values[0]).toBeCloseTo(240);
  expect(path[1]?.values[1]).toBeCloseTo(10);
});

test('R2.6 weightChartPath pads the weight range by ten percent on both sides', () => {
  const path = commands(weightChartPath(entries([2, 4, 3]), 240, 120));
  const ends = path.map(({ values }) => ({ x: values.at(-2), y: values.at(-1) }));
  expect(ends).toHaveLength(3);
  // The padded domain is 1.8..4.2 kg, not ten percent of each measurement.
  for (const [index, y] of [110, 10, 60].entries()) {
    expect(ends[index]?.y).toBeCloseTo(y);
  }
  // Uneven measurement intervals must produce uneven horizontal spacing.
  for (const [index, x] of [0, 60, 240].entries()) {
    expect(ends[index]?.x).toBeCloseTo(x);
  }
});

test('R2.6 weightChartPath stays monotone within every neighbouring pair', () => {
  const weights = [2, 5, 5, 2.1, 2, 4];
  const path = commands(weightChartPath(entries(weights), 330, 180));
  expect(path.map((command) => command.kind)).toEqual(['M', 'C', 'C', 'C', 'C', 'C']);
  let startX = path[0]?.values[0] ?? NaN;
  let startY = path[0]?.values[1] ?? NaN;
  for (const [index, { values }] of path.slice(1).entries()) {
    const [x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN, endX = NaN, endY = NaN] = values;
    const expectedY = (kg: number) => (5.3 - kg) / 3.6 * 180;
    expect(startY).toBeCloseTo(expectedY(weights[index] ?? NaN));
    expect(endY).toBeCloseTo(expectedY(weights[index + 1] ?? NaN));
    let previousY = startY;
    let previousX = startX;
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100;
      const u = 1 - t;
      const cubic = (a: number, b: number, c: number, d: number) =>
        u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d;
      const x = cubic(startX, x1, x2, endX);
      const y = cubic(startY, y1, y2, endY);
      expect(x).toBeGreaterThanOrEqual(previousX - 1e-8);
      expect(y).toBeGreaterThanOrEqual(Math.min(startY, endY) - 1e-8);
      expect(y).toBeLessThanOrEqual(Math.max(startY, endY) + 1e-8);
      if (endY >= startY) expect(y).toBeGreaterThanOrEqual(previousY - 1e-8);
      else expect(y).toBeLessThanOrEqual(previousY + 1e-8);
      previousX = x;
      previousY = y;
    }
    startX = endX;
    startY = endY;
  }
});
