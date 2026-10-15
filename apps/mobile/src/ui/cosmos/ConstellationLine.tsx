import type { ReactElement } from 'react';

export type ConstellationPoint = { x: number; y: number };
export type ConstellationLineProps = {
  points: readonly ConstellationPoint[];
  width: number;
  height: number;
  complete: boolean;
  active: boolean;
  testID?: string;
};

export function ConstellationLine(props: ConstellationLineProps): ReactElement | null {
  void props;
  throw new Error('ConstellationLine is not implemented');
}
