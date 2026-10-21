import { createAccumulator, type WalkAccumulator, type WalkPoint } from '@pawlaris/shared';
import type { SqlDriver } from '../db/driver';
import { WalkRepo, type WalkPoint as StoredWalkPoint } from '../db/walkRepo';

export interface PointStore {
  append(walkId: string, point: WalkPoint, accumulator?: WalkAccumulator): void;
  read(walkId: string): StoredWalkPoint[];
  rebuild(walkId: string): WalkAccumulator;
}

export function createPointStore(driver: SqlDriver): PointStore {
  const walks = new WalkRepo(driver);
  return {
    append(walkId, point, accumulator) {
      driver.transaction(() => {
        const seq = driver.all<{ seq: number }>(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM walk_point WHERE walk_id = ?', [walkId],
        )[0]?.seq ?? 1;
        walks.insertPoint({ ...point, walkId, seq });
      });
      // A failed aggregation must never cost the fix that triggered it.
      accumulator?.add(point);
    },
    read: (walkId) => walks.points(walkId),
    rebuild(walkId) {
      const accumulator = createAccumulator();
      for (const { lat, lon, t, acc, paused } of walks.points(walkId)) {
        accumulator.add({ lat, lon, t, acc, paused });
      }
      return accumulator;
    },
  };
}
