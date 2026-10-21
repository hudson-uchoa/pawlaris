import { act, render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { PermissionStatus } from 'expo';
import type { WalkPoint } from '@pawlaris/shared';
import { ReplicaProvider } from '../../../replica/useReplica';
import { trackingStorage, locationFix } from '../../../walks/__tests__/trackingSupport';
import { discardLocalWalk, finishLocalWalk, type LiveWalkServices } from '../../../walks/live';
import { createTracker } from '../../../walks/tracker';
import { handleWalkTask, WALK_LOCATION_TASK } from '../../../walks/task';
import type { TrackingMode } from '../../../walks/permissions';
import { LiveWalkScreen } from '../LiveWalkScreen';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  startLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn(),
  watchPositionAsync: jest.fn(), getBackgroundPermissionsAsync: jest.fn(),
}));

export function resetLivePlatform(): void {
  jest.clearAllMocks();
  jest.mocked(Location.startLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.stopLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.watchPositionAsync).mockResolvedValue({ remove() {} });
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({
    status: PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: 'never',
  });
}

export async function liveContext(mode: TrackingMode = 'service') {
  const c = await trackingStorage();
  if (mode === 'foreground') {
    jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValue(
      Object.assign(new Error('Background location permission is required'), {
        code: 'E_LOCATION_BACKGROUND_UNAUTHORIZED',
      }),
    );
  }
  const tracker = createTracker({ ...c, location: Location,
    async requestBackgroundLocation() { return false; } });
  const walk = await tracker.start(c.pet.id);
  const dependencies = { ...c, tracker };
  const finished: string[] = [];
  let discarded = 0;
  let settingsOpened = 0;
  const services: LiveWalkServices = {
    clock: c.clock, points: c.points, tracker,
    readLocalWalk: () => c.walks.getLocal(),
    finish: () => finishLocalWalk(dependencies),
    discard: () => discardLocalWalk(dependencies),
  };
  const props = { services, active: true,
    onFinished: (id: string) => { finished.push(id); },
    onDiscarded: () => { discarded += 1; },
    onLocationSettings: () => { settingsOpened += 1; },
  };
  return { ...c, tracker, walk, services, dependencies, props, finished,
    discarded: () => discarded, settingsOpened: () => settingsOpened,
    paint: () => render(<ReplicaProvider store={c.store}><LiveWalkScreen {...props} /></ReplicaProvider>),
    async fix(point: WalkPoint) {
      await handleWalkTask({ driver: c.driver, points: c.points }, {
        data: { locations: [locationFix(point)] }, error: null,
        executionInfo: { taskName: WALK_LOCATION_TASK, eventId: 'live-fix' },
      });
    },
    async tick(milliseconds: number) {
      await act(async () => {
        c.clock.advance(milliseconds);
        await jest.advanceTimersByTimeAsync(milliseconds);
      });
    },
  };
}

export type LiveContext = Awaited<ReturnType<typeof liveContext>>;

export function pointAt(c: LiveContext, latitudeOffset = 0, acc = 4): WalkPoint {
  return { lat: -23.55 + latitudeOffset, lon: -46.63, t: c.clock.now(), acc, paused: false };
}

export async function seedMovingWalk(c: LiveContext, durationMs = 60_000, latitudeOffset = 0.001): Promise<void> {
  await c.fix(pointAt(c));
  c.clock.advance(durationMs);
  await c.fix(pointAt(c, latitudeOffset));
}

export async function seedUploadWalk(c: LiveContext): Promise<void> {
  // Each zigzag leg has a collinear midpoint. The simplified line still has
  // more than 32 corners, so both simplification and preview sampling matter.
  for (let index = 0; index <= 80; index += 1) {
    const corner = Math.floor(index / 2);
    const lonOffset = index % 2 === 1 ? 0.00015 : corner % 2 * 0.0003;
    await c.fix({ ...pointAt(c, index * 0.0001), lon: -46.63 + lonOffset });
    c.clock.advance(3000);
    if (index === 20) {
      await c.fix({ ...pointAt(c, 0.1, 500), lon: -46.5 });
      c.clock.advance(3000);
    }
    if (index === 40) {
      c.tracker.pause();
      await c.fix({ ...pointAt(c, 0.2), lon: -46.4 });
      c.clock.advance(60_000);
      c.tracker.resume();
    }
  }
}
