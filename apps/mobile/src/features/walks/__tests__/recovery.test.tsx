import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { routeForUpload, routePreview } from '@pawlaris/shared';
import { formatDistance } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { hydrate } from '../../../replica/hydrate';
import { createWalkRecovery, type WalkRecovery } from '../../../walks/recover';
import { createTracker } from '../../../walks/tracker';
import { WALK_LOCATION_TASK } from '../../../walks/task';
import { trackPoint, trackingStorage } from '../../../walks/__tests__/trackingSupport';
import { WalkRecoverySheet } from '../WalkRecoverySheet';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 }, startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(), watchPositionAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(), hasStartedLocationUpdatesAsync: jest.fn(),
}));

let c: Awaited<ReturnType<typeof trackingStorage>>;
let recovery: WalkRecovery | undefined;
const initialState = AppState.currentState;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.mocked(Location.startLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.stopLocationUpdatesAsync).mockResolvedValue(undefined);
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
  c = await trackingStorage();
  c.clock.advance(Date.parse('2026-10-21T21:02:00Z') - c.clock.now());
});

afterEach(async () => {
  await cleanup();
  recovery?.dispose();
  recovery = undefined;
  c.driver.close();
  AppState.currentState = initialState;
  jest.clearAllTimers();
  jest.useRealTimers();
});

function recorder() {
  return createTracker({ ...c, location: Location,
    async requestBackgroundLocation() { return false; } });
}

async function orphan(withPoints = true) {
  const tracker = recorder();
  const walk = await tracker.start(c.pet.id);
  if (withPoints) {
    for (let index = 0; index <= 108; index += 1) {
      c.points.append(walk.id, trackPoint(c.clock.now(), index));
      c.clock.advance(3000);
    }
  }
  // A fresh tracker and SQLite connection represent a killed JS runtime.
  const reopened = await trackingStorage(c.driver.export());
  c.driver.close();
  c = reopened;
  c.clock.advance(Date.parse('2026-10-22T12:00:00Z') - c.clock.now());
  hydrate(c);
  jest.mocked(Location.startLocationUpdatesAsync).mockClear();
  return walk;
}

function recover() {
  recovery = createWalkRecovery({ ...c, tracker: recorder(), location: Location });
  return recovery;
}

async function paint(service: WalkRecovery) {
  await service.recoverIfNeeded();
  const finished: string[] = [];
  let continued = false;
  await render(<WalkRecoverySheet recovery={service.getSnapshot()}
    timezone="America/Sao_Paulo" active
    onContinue={async () => { await service.continue(); continued = true; }}
    onFinish={async () => { finished.push(await service.finish()); }} />);
  return { finished, continued: () => continued };
}

test('R4.6 an orphaned local_walk produces the sheet with the stored distance', async () => {
  const walk = await orphan();
  const stored = c.points.read(walk.id);
  const distanceM = c.points.rebuild(walk.id).snapshot().distanceM;
  expect(distanceM).toBeGreaterThan(1190);
  expect(distanceM).toBeLessThan(1210);
  await paint(recover());
  expect(Location.hasStartedLocationUpdatesAsync).toHaveBeenCalledWith(WALK_LOCATION_TASK);
  expect(screen.getByText(strings.walks.recoveryMessage('18:02', formatDistance(distanceM))))
    .toBeOnTheScreen();
  expect(screen.getByRole('button', { name: strings.walks.resume })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: strings.walks.recoveryFinish })).toBeOnTheScreen();
  expect(c.points.read(walk.id)).toEqual(stored);
  expect(c.walks.getLocal()).toEqual(walk);
  expect(c.outbox.count()).toBe(1);
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

test('09 section 8.3 the recovery sheet uses the stored start time and distance verbatim', async () => {
  const walk = await orphan();
  const distanceM = c.points.rebuild(walk.id).snapshot().distanceM;
  await render(<WalkRecoverySheet recovery={{ walk, distanceM }}
    timezone="America/Sao_Paulo" active
    onContinue={async () => { await recover().continue(); }}
    onFinish={async () => { await recover().finish(); }} />);
  expect(screen.getByText(strings.walks.recoveryMessage('18:02', formatDistance(distanceM))))
    .toBeOnTheScreen();
  expect(screen.getByRole('button', { name: strings.walks.resume })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: strings.walks.recoveryFinish })).toBeOnTheScreen();
});

test('R4.6 Continuar restarts tracking and keeps points without another startWalk', async () => {
  const walk = await orphan();
  const points = c.points.read(walk.id);
  const queued = c.driver.all('SELECT * FROM outbox ORDER BY seq');
  const view = await paint(recover());
  await fireEvent.press(screen.getByRole('button', { name: strings.walks.resume }));
  expect(view.continued()).toBe(true);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(WALK_LOCATION_TASK,
    expect.objectContaining({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 0,
      foregroundService: expect.objectContaining({ notificationTitle: strings.walks.ongoingNotificationTitle }) }));
  expect(c.points.read(walk.id)).toEqual(points);
  expect(c.walks.getLocal()).toEqual(walk);
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(queued);
  expect(c.store.getState().walks[walk.id]?.status).toBe('active');
});

test('R4.6 Encerrar finishes with ended_at equal to the last stored point time', async () => {
  const walk = await orphan();
  const stored = c.points.read(walk.id);
  const last = stored.at(-1);
  if (last === undefined) throw new Error('The fixture must contain a last point');
  const distanceM = c.points.rebuild(walk.id).snapshot().distanceM;
  const route = routeForUpload(stored);
  expect(c.clock.now()).toBeGreaterThan(last.t + 60_000);
  const view = await paint(recover());
  await fireEvent.press(screen.getByRole('button', { name: strings.walks.recoveryFinish }));
  expect(view.finished).toEqual([walk.id]);
  const entries = c.driver.all<{ path: string; body: string }>('SELECT path, body FROM outbox ORDER BY seq');
  expect(entries).toHaveLength(2);
  expect(entries.map(({ path }) => path)).toEqual(['/walks', `/walks/${walk.id}/finish`]);
  const finish = entries[1];
  if (finish === undefined) throw new Error('Recovery did not enqueue finishWalk');
  expect(JSON.parse(finish.body)).toMatchObject({
    ended_at: new Date(last.t).toISOString(),
    started_at: new Date(walk.startedAt).toISOString(),
    duration_s: Math.floor((last.t - walk.startedAt) / 1000),
    distance_m: distanceM, route, preview: routePreview(route),
  });
  expect(c.store.getState().walks[walk.id]).toMatchObject({ status: 'finished',
    ended_at: new Date(last.t).toISOString() });
  expect(c.walks.getRoute(walk.id)).toEqual(route);
  expect(c.walks.getLocal()).toBeNull();
  expect(c.points.read(walk.id)).toEqual([]);
});

test('R4.6 a failed tracker.start orphan with no points produces the recovery sheet', async () => {
  const failure = new Error('Location services are disabled');
  jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValueOnce(failure);
  await expect(recorder().start(c.pet.id)).rejects.toBe(failure);
  const walk = c.walks.getLocal();
  if (walk === null) throw new Error('The failed start must leave its durable walk');
  const queued = c.driver.all('SELECT * FROM outbox ORDER BY seq');
  expect(queued).toHaveLength(1);
  await paint(recover());
  expect(screen.getByText(strings.walks.recoveryMessage('18:02', formatDistance(0))))
    .toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: strings.walks.resume }));
  expect(c.walks.getLocal()?.id).toBe(walk.id);
  expect(c.points.read(walk.id)).toEqual([]);
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(queued);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
});

test('R4.6 an already running service does not produce a recovery sheet', async () => {
  const walk = await orphan();
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
  const service = recover();
  await paint(service);
  expect(service.getSnapshot()).toBeNull();
  expect(screen.queryByRole('button', { name: strings.walks.recoveryFinish })).toBeNull();
  expect(c.walks.getLocal()).toEqual(walk);
  expect(c.outbox.count()).toBe(1);
});
