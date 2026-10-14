import type { Random } from '../platform/random';

export function fakeRandom(...values: number[]): Random {
  const remaining = [...values];
  return {
    next(): number {
      const value = remaining.shift();
      if (value === undefined) throw new Error('Fake random has no queued value');
      if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError('Fake random value must be in [0, 1)');
      }
      return value;
    },
  };
}
