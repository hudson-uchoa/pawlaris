import { Accuracy, type LocationSubscription } from 'expo-location';
import type { SqlDriver } from '../db/driver';
import type { Kv } from '../db/kv';
import { WalkRepo, type LocalWalk } from '../db/walkRepo';
import { strings } from '../i18n/strings';
import type { Clock } from '../platform/clock';
import type { Mutations } from '../sync/mutations';
import type { PointStore } from './pointStore';
import { handleWalkTask, WALK_LOCATION_TASK } from './task';

export type TrackingLocationPort = Pick<typeof import('expo-location'),
  | 'startLocationUpdatesAsync' | 'stopLocationUpdatesAsync'
  | 'watchPositionAsync' | 'getBackgroundPermissionsAsync'>;

export interface TrackerDependencies {
  driver: SqlDriver;
  kv: Kv;
  clock: Clock;
  points: PointStore;
  mutations: Pick<Mutations, 'startWalk'>;
  location: TrackingLocationPort;
  requestBackgroundLocation(): Promise<boolean>;
}

export interface WalkTracker {
  start(petId: string): Promise<LocalWalk>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}

export function createTracker(dependencies: TrackerDependencies): WalkTracker {
  const { driver, kv, clock, points, mutations, location, requestBackgroundLocation } = dependencies;
  const walks = new WalkRepo(driver);
  const sampling = { accuracy: Accuracy.High, timeInterval: 3000, distanceInterval: 0 };
  const serviceOptions = { ...sampling,
    foregroundService: { notificationTitle: strings.walks.ongoingNotificationTitle,
      notificationBody: strings.walks.ongoingNotificationTitle },
  };
  let subscription: LocationSubscription | undefined;
  let serviceRunning = false;
  const startService = async (): Promise<void> => {
    await location.startLocationUpdatesAsync(WALK_LOCATION_TASK, serviceOptions);
    serviceRunning = true;
  };
  return {
    async start(petId) {
      const walk = driver.transaction((): LocalWalk => {
        if (walks.getLocal() !== null) throw new Error('A walk is already in progress on this device');
        const startedAt = clock.now();
        const id = mutations.startWalk({ pet_id: petId, started_at: new Date(startedAt).toISOString() });
        const local: LocalWalk = { id, petId, state: 'active', startedAt,
          pausedMs: 0, pauseStartedAt: null, trackingMode: 'service' };
        walks.upsertLocal(local);
        return local;
      });
      try {
        await startService();
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error)
          || error.code !== 'E_LOCATION_BACKGROUND_UNAUTHORIZED') throw error;
        kv.set('needs_background_location', '1');
        if ((await location.getBackgroundPermissionsAsync()).granted || await requestBackgroundLocation()) {
          await startService();
        } else {
          walk.trackingMode = 'foreground';
          walks.upsertLocal(walk);
          subscription = await location.watchPositionAsync(sampling, (fix) => {
            // The same disk-first path handles both native delivery modes.
            void handleWalkTask({ driver, points }, {
              data: { locations: [fix] }, error: null,
              executionInfo: { taskName: WALK_LOCATION_TASK, eventId: 'foreground' },
            });
          });
        }
      }
      return walk;
    },
    pause() {
      driver.transaction(() => {
        const walk = walks.getLocal();
        if (walk === null || walk.state === 'paused') return;
        const pausedAt = clock.now();
        const last = points.read(walk.id).at(-1);
        walks.upsertLocal({ ...walk, state: 'paused', pauseStartedAt: pausedAt });
        if (last !== undefined) points.append(walk.id, { ...last, t: pausedAt, paused: true });
      });
    },
    resume() {
      const walk = walks.getLocal();
      if (walk === null || walk.state === 'active') return;
      walks.upsertLocal({ ...walk, state: 'active', pauseStartedAt: null,
        pausedMs: walk.pausedMs + clock.now() - (walk.pauseStartedAt ?? clock.now()) });
    },
    async stop() {
      subscription?.remove();
      subscription = undefined;
      if (serviceRunning) {
        await location.stopLocationUpdatesAsync(WALK_LOCATION_TASK);
        serviceRunning = false;
      }
    },
  };
}
