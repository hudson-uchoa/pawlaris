import type { WeightEntry } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export type WeightChartProps = {
  entries: readonly WeightEntry[];
  width: number;
  height: number;
  timezone: string;
  active: boolean;
};

export const WeightChart: (props: WeightChartProps) => ReactElement = () => {
  throw new Error('not implemented');
};
