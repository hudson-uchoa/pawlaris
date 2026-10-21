import type { WalkAccumulator, WalkPoint } from '@pawlaris/shared';
import type { SqlDriver } from '../db/driver';
import type { WalkPoint as StoredWalkPoint } from '../db/walkRepo';

export interface PointStore {
  append(walkId: string, point: WalkPoint, accumulator?: WalkAccumulator): void;
  read(walkId: string): StoredWalkPoint[];
  rebuild(walkId: string): WalkAccumulator;
}

export function createPointStore(driver: SqlDriver): PointStore {
  void driver;
  return {
    append(walkId, point, accumulator) {
      void walkId; void point; void accumulator;
      throw new Error('not implemented');
    },
    read(walkId) {
      void walkId;
      throw new Error('not implemented');
    },
    rebuild(walkId) {
      void walkId;
      throw new Error('not implemented');
    },
  };
}
