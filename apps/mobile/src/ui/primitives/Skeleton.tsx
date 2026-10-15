import type { ReactElement } from 'react';

export type SkeletonProps = {
  width: number;
  height: number;
  active: boolean;
  testID?: string;
};

export function Skeleton(_props: SkeletonProps): ReactElement | null {
  return null;
}
