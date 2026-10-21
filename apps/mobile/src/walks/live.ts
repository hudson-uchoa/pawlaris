import { createAccumulator, currentSpeedMps, movingSeconds, paceSecPerKm, routeForUpload, routePreview } from '@pawlaris/shared';
import type { SqlDriver } from '../db/driver';
import { WalkRepo, type LocalWalk } from '../db/walkRepo';
import type { Clock } from '../platform/clock';
import type { Mutations } from '../sync/mutations';
import type { PointStore } from './pointStore';
import type { WalkTracker } from './tracker';

export interface LocalWalkActionDependencies {
  driver: SqlDriver;
  clock: Clock;
  points: PointStore;
  tracker: WalkTracker;
  mutations: Pick<Mutations, 'finishWalk' | 'discardWalk'>;
}

export interface LiveWalkServices {
  clock: Clock;
  points: PointStore;
  tracker: WalkTracker;
  readLocalWalk(): LocalWalk | null;
  finish(): Promise<string>;
  discard(): Promise<void>;
}

export interface LiveWalkMetrics {
  walk: LocalWalk | null;
  distanceM: number;
  seconds: number;
  speed: number;
  pace: number | null;
  signal: 'good' | 'weak' | 'none';
}

export function createLiveWalkReader(services: LiveWalkServices): () => LiveWalkMetrics {
  const initial = services.readLocalWalk();
  let walkId = initial?.id;
  let accumulator = initial === null ? createAccumulator() : services.points.rebuild(initial.id);
  return () => {
    const walk = services.readLocalWalk();
    if (walk?.id !== walkId) {
      walkId = walk?.id;
      accumulator = walk === null ? createAccumulator() : services.points.rebuild(walk.id);
    }
    const points = walk === null ? [] : services.points.read(walk.id);
    for (const point of points.slice(accumulator.snapshot().pointCount)) accumulator.add(point);
    const now = services.clock.now();
    const distanceM = accumulator.snapshot().distanceM;
    const seconds = walk === null ? 0 : movingSeconds(walk.startedAt, now, totalPausedMs(walk, now));
    const last = points.at(-1);
    const signal = now - (last?.t ?? walk?.startedAt ?? now) > 15_000
      ? 'none' : last === undefined || last.acc > 30 ? 'weak' : 'good';
    return { walk, distanceM, seconds, signal, speed: currentSpeedMps(points),
      pace: paceSecPerKm(distanceM, seconds) };
  };
}

export function totalPausedMs(walk: LocalWalk, now: number): number {
  return walk.pausedMs + (walk.pauseStartedAt === null ? 0 : now - walk.pauseStartedAt);
}

export async function finishLocalWalk({ driver, clock, points, tracker, mutations }: LocalWalkActionDependencies): Promise<string> {
  // Keep the raw fixes intact if the native recorder cannot be stopped.
  await tracker.stop();
  return driver.transaction(() => {
    const walks = new WalkRepo(driver);
    const walk = walks.getLocal();
    if (walk === null) throw new Error('There is no local walk to finish');
    const now = clock.now();
    const pausedMs = totalPausedMs(walk, now);
    const seconds = movingSeconds(walk.startedAt, now, pausedMs);
    const distanceM = points.rebuild(walk.id).snapshot().distanceM;
    const pace = paceSecPerKm(distanceM, seconds);
    const route = routeForUpload(points.read(walk.id));
    mutations.finishWalk(walk.id, {
      pet_id: walk.petId, started_at: new Date(walk.startedAt).toISOString(),
      ended_at: new Date(now).toISOString(), paused_ms: pausedMs,
      distance_m: distanceM, duration_s: Math.floor(seconds),
      avg_pace_s_per_km: pace === null ? null : Math.round(pace),
      route, preview: routePreview(route),
    });
    walks.upsertRoute({ walkId: walk.id, points: route });
    walks.removePoints(walk.id);
    walks.removeLocal(walk.id);
    return walk.id;
  });
}

export async function discardLocalWalk({ driver, tracker, mutations }: LocalWalkActionDependencies): Promise<void> {
  await tracker.stop();
  driver.transaction(() => {
    const walks = new WalkRepo(driver);
    const walk = walks.getLocal();
    if (walk === null) return;
    mutations.discardWalk(walk.id);
    walks.removeRoute(walk.id);
    walks.removePoints(walk.id);
    walks.removeLocal(walk.id);
  });
}
