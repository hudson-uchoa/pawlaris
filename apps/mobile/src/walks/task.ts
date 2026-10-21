import type { LocationObject } from 'expo-location';
import { defineTask, type TaskManagerTaskBody } from 'expo-task-manager';
import { expoSqliteDriver, type SqlDriver } from '../db/driver';
import { openDatabase } from '../db/open';
import { WalkRepo } from '../db/walkRepo';
import { createPointStore, type PointStore } from './pointStore';

export const WALK_LOCATION_TASK = 'pawlaris.walk-location';

export interface WalkLocationData {
  locations: LocationObject[];
}

export interface WalkTaskDependencies {
  driver: SqlDriver;
  points: PointStore;
}

export async function handleWalkTask(
  dependencies: WalkTaskDependencies,
  body: TaskManagerTaskBody<WalkLocationData>,
): Promise<void> {
  if (body.error !== null) throw new Error(body.error.message);
  const walk = new WalkRepo(dependencies.driver).getLocal();
  if (walk === null || body.data === undefined) return;
  for (const fix of body.data.locations) {
    dependencies.points.append(walk.id, {
      lat: fix.coords.latitude, lon: fix.coords.longitude,
      t: fix.timestamp, acc: fix.coords.accuracy ?? Number.MAX_VALUE,
      paused: walk.state === 'paused',
    });
  }
}

// Android may start this module with no React tree or application runtime.
defineTask<WalkLocationData>(WALK_LOCATION_TASK, async (body) => {
  const driver = expoSqliteDriver();
  openDatabase(driver);
  await handleWalkTask({ driver, points: createPointStore(driver) }, body);
});
