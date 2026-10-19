import type { WeightEntry } from '@pawlaris/shared';

export type WeightChartEntry = Pick<WeightEntry, 'measured_at' | 'weight_kg'>;

/** Absolute SVG path, using M, L and C commands. */
export const weightChartPath: (
  entries: readonly WeightChartEntry[], width: number, height: number,
) => string = () => {
  throw new Error('not implemented');
};
