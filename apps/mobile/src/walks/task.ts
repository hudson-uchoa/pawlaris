import type { LocationObject } from 'expo-location';
import type { TaskManagerTaskBody } from 'expo-task-manager';
import type { SqlDriver } from '../db/driver';
import type { PointStore } from './pointStore';

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
  void dependencies; void body;
  throw new Error('not implemented');
}
