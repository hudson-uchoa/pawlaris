import { createAccumulator, haversineM } from '@pawlaris/shared';
import * as Location from 'expo-location';
import { PermissionStatus } from 'expo';
import { strings } from '../../i18n/strings';
import { createTracker } from '../tracker';
import { handleWalkTask, WALK_LOCATION_TASK } from '../task';
import { locationFix, trackPoint, trackingStorage } from './trackingSupport';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  startLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn(),
  watchPositionAsync: jest.fn(), getBackgroundPermissionsAsync: jest.fn(),
}));

let c: Awaited<ReturnType<typeof trackingStorage>>;
let watchCallback: Location.LocationCallback | undefined;
let removed: boolean;
let backgroundChoices: number;

function tracker() {
  return createTracker({ ...c, location: Location,
    async requestBackgroundLocation() { backgroundChoices += 1; return false; } });
}

beforeEach(async () => {
  jest.resetAllMocks();
  c = await trackingStorage();
  watchCallback = undefined;
  removed = false;
  backgroundChoices = 0;
  jest.mocked(Location.startLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.stopLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({
    status: PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: 'never',
  });
  jest.mocked(Location.watchPositionAsync).mockImplementation(async (_options, callback) => {
    watchCallback = callback;
    return { remove() { removed = true; } };
  });
});
afterEach(() => { c.driver.close(); });

async function deliver(...indices: number[]): Promise<void> {
  const locations = indices.map((index, offset) => locationFix(trackPoint(c.clock.now() + offset * 3000, index)));
  await handleWalkTask({ driver: c.driver, points: c.points }, {
    data: { locations }, error: null,
    executionInfo: { taskName: WALK_LOCATION_TASK, eventId: 'location-event' },
  });
}

test('R4.3 R4.7 R4.9 starts the service and durably queues the optimistic walk', async () => {
  const startedAt = c.clock.now();
  // Even the native start observes both durable writes before it can emit a fix.
  jest.mocked(Location.startLocationUpdatesAsync).mockImplementation(async () => {
    expect(c.walks.getLocal()).toMatchObject({ petId: c.pet.id, state: 'active' });
    expect(c.outbox.count()).toBe(1);
  });
  const running = tracker();
  const walk = await running.start(c.pet.id);
  expect(walk).toMatchObject({ petId: c.pet.id, state: 'active', startedAt,
    pausedMs: 0, pauseStartedAt: null, trackingMode: 'service' });
  expect(c.walks.getLocal()).toEqual(walk);
  expect(c.store.getState().walks[walk.id]).toMatchObject({
    id: walk.id, pet_id: c.pet.id, status: 'active', revision: null,
    started_at: new Date(startedAt).toISOString(),
  });
  const queued = c.outbox.head(c.userId);
  expect(queued).toMatchObject({ method: 'POST', path: '/walks', entity: 'walk_sessions',
    entityId: walk.id, userId: c.userId, createdAt: startedAt,
    body: { id: walk.id, pet_id: c.pet.id, started_at: new Date(startedAt).toISOString() } });
  expect(queued?.clientMutationId).toEqual(expect.any(String));
  expect(queued?.clientMutationId).not.toBe(walk.id);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(WALK_LOCATION_TASK,
    expect.objectContaining({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 0,
      foregroundService: expect.objectContaining({ notificationTitle: strings.walks.ongoingNotificationTitle }) }));
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  expect(backgroundChoices).toBe(0);
  expect(c.kv.get('needs_background_location')).toBeNull();
  await running.stop();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(WALK_LOCATION_TASK);
});

test('R4.3 falls back to foreground and persists the background-location ladder flag', async () => {
  jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValue(
    Object.assign(new Error('Background location permission is required'), { code: 'E_LOCATION_BACKGROUND_UNAUTHORIZED' }),
  );
  const running = tracker();
  const walk = await running.start(c.pet.id);
  expect(walk.trackingMode).toBe('foreground');
  expect(c.walks.getLocal()).toMatchObject({ id: walk.id, trackingMode: 'foreground' });
  expect(c.kv.get('needs_background_location')).toBe('1');
  expect(backgroundChoices).toBe(1);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(Location.watchPositionAsync).toHaveBeenCalledWith(
    expect.objectContaining({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 0 }),
    expect.any(Function),
  );
  expect(c.outbox.count()).toBe(1);
  const callback = watchCallback;
  if (callback === undefined) throw new Error('Foreground location callback was not installed');
  const first = trackPoint(c.clock.now());
  callback(locationFix(first));
  expect(c.walks.points(walk.id)).toHaveLength(1);
  expect(c.walks.points(walk.id)[0]).toMatchObject(first);
  const reopened = await trackingStorage(c.driver.export());
  try {
    expect(reopened.kv.get('needs_background_location')).toBe('1');
    expect(reopened.walks.getLocal()?.trackingMode).toBe('foreground');
  } finally { reopened.driver.close(); }
  await running.stop();
  expect(removed).toBe(true);
});

test.each(['active', 'paused'] as const)(
    'R4.7 rejects a second start when the walk is %s even from a fresh tracker', async (state) => {
    const running = tracker();
    const first = await running.start(c.pet.id);
    if (state === 'paused') running.pause();
    const before = c.walks.getLocal();
    const otherPet = '00000000-0000-4000-8000-000000000099';
    await expect(running.start(otherPet)).rejects.toThrow();
    await expect(tracker().start(otherPet)).rejects.toThrow();
    expect(c.walks.getLocal()).toEqual(before);
    expect(c.driver.all('SELECT id FROM local_walk')).toEqual([{ id: first.id }]);
    expect(c.outbox.count()).toBe(1);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  },
);

test('WK-1 R4.5 the service task persists every batched fix in order', async () => {
  // Seed only the local device row: this task must work with no mounted UI.
  c.walks.upsertLocal({ id: 'walk', petId: c.pet.id, state: 'active', startedAt: c.clock.now(),
    pausedMs: 0, pauseStartedAt: null, trackingMode: 'service' });
  await deliver(0, 1, 2);
  const stored = c.walks.points('walk');
  expect(stored).toHaveLength(3);
  expect(stored.map(({ seq }) => seq)).toEqual([...new Set(stored.map(({ seq }) => seq))].sort((a, b) => a - b));
  expect(stored.map(({ lat, lon, t, acc, paused }) => ({ lat, lon, t, acc, paused })))
    .toEqual([0, 1, 2].map((index) => trackPoint(c.clock.now() + index * 3000, index)));
  expect(c.points.rebuild('walk').snapshot().pointCount).toBe(3);
});

test('R4.13 flags service fixes received while the local walk is paused', async () => {
  c.walks.upsertLocal({ id: 'walk', petId: c.pet.id, state: 'paused', startedAt: c.clock.now(),
    pausedMs: 0, pauseStartedAt: c.clock.now(), trackingMode: 'service' });
  await deliver(0, 1);
  expect(c.walks.points('walk').map(({ paused }) => paused)).toEqual([true, true]);
  expect(c.points.rebuild('walk').snapshot().distanceM).toBe(0);
});

test('R4.13 pause without a native fix writes a marker and excludes the segment across it', async () => {
  const running = tracker();
  const walk = await running.start(c.pet.id);
  const first = trackPoint(c.clock.now());
  await deliver(0);
  c.clock.advance(3000);
  const pausedAt = c.clock.now();
  running.pause();
  expect(c.walks.getLocal()).toMatchObject({ state: 'paused', pauseStartedAt: pausedAt });
  expect(c.walks.points(walk.id)).toHaveLength(2);
  expect(c.walks.points(walk.id).at(-1)).toMatchObject({
    lat: first.lat, lon: first.lon, acc: first.acc, t: pausedAt, paused: true,
  });
  c.clock.advance(60_000);
  // No native callback is delivered while paused.
  running.resume();
  expect(c.walks.getLocal()).toMatchObject({ state: 'active', pauseStartedAt: null, pausedMs: 60_000 });
  await deliver(100, 101);
  const uninterruptedSegment = createAccumulator();
  uninterruptedSegment.add(trackPoint(c.clock.now(), 100));
  uninterruptedSegment.add(trackPoint(c.clock.now() + 3000, 101));
  const expected = uninterruptedSegment.snapshot().distanceM;
  expect(haversineM(first, trackPoint(c.clock.now(), 100))).toBeGreaterThan(1000);
  expect(expected).toBeGreaterThan(10);
  expect(c.points.rebuild(walk.id).snapshot().distanceM).toBeCloseTo(expected, 5);
  expect(c.outbox.count()).toBe(1);
});
