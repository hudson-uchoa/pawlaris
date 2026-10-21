import { liveContext, pointAt, resetLivePlatform, seedMovingWalk, seedUploadWalk,
  type LiveContext } from './liveSupport';
import {
  currentSpeedMps, movingSeconds, paceSecPerKm, routeForUpload, routePreview,
} from '@pawlaris/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { formatDecimal, formatDistance, formatDuration, formatPace } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { trackingStorage } from '../../../walks/__tests__/trackingSupport';
import { discardLocalWalk, finishLocalWalk } from '../../../walks/live';

let c: LiveContext | undefined;
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  resetLivePlatform();
  AppState.currentState = 'active';
});

afterEach(async () => {
  await cleanup();
  if (c !== undefined) {
    await c.tracker.stop();
    c.driver.close();
  }
  c = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene(mode: 'service' | 'foreground' = 'service'): Promise<LiveContext> {
  c = await liveContext(mode);
  return c;
}

function speedText(metresPerSecond: number): string {
  return `${formatDecimal(metresPerSecond * 3.6, 1)} ${strings.walks.speedUnit}`;
}

test.each([0, 0.0002])('R4.12 pace shows -- below 0.5 m/s with latitude delta %s', async (delta) => {
  const s = await scene();
  await s.fix(pointAt(s));
  s.clock.advance(50_000);
  await s.fix(pointAt(s));
  s.clock.advance(10_000);
  await s.fix(pointAt(s, delta));
  const distance = s.points.rebuild(s.walk.id).snapshot().distanceM;
  expect(distance / 60).toBeLessThan(0.5);
  // In the nonzero case current speed is above the pace threshold. The
  // placeholder must depend on average speed, not the last ten seconds.
  if (delta > 0) expect(currentSpeedMps(s.points.read(s.walk.id))).toBeGreaterThan(0.5);
  await s.paint();
  expect(screen.getByTestId('walk-pace')).toHaveTextContent('--');
  expect(screen.getByTestId('walk-speed')).toHaveTextContent(speedText(currentSpeedMps(s.points.read(s.walk.id))));
});

test('R4.12 WK-1 mount rebuilds distance and pace from persisted points', async () => {
  const s = await scene();
  await seedMovingWalk(s);
  const distance = s.points.rebuild(s.walk.id).snapshot().distanceM;
  expect(distance / 60).toBeGreaterThan(0.5);
  await s.paint();
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(distance));
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(60));
  expect(screen.getByTestId('walk-pace')).toHaveTextContent(formatPace(paceSecPerKm(distance, 60)));
});

test('R4.13 pause and resume exclude paused time from elapsed and average pace', async () => {
  const s = await scene();
  await seedMovingWalk(s);
  const distanceBeforePause = s.points.rebuild(s.walk.id).snapshot().distanceM;
  await s.paint();
  await fireEvent.press(screen.getByTestId('walk-pause'));
  expect(s.walks.getLocal()).toMatchObject({ state: 'paused', pauseStartedAt: s.clock.now() });
  await s.tick(90_000);
  await act(async () => { await s.fix(pointAt(s, 0.1)); });
  expect(s.points.read(s.walk.id).at(-1)?.paused).toBe(true);
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(60));
  expect(screen.getByTestId('walk-pace')).toHaveTextContent(formatPace(paceSecPerKm(distanceBeforePause, 60)));
  await fireEvent.press(screen.getByTestId('walk-resume-live'));
  expect(s.walks.getLocal()).toMatchObject({ state: 'active', pausedMs: 90_000, pauseStartedAt: null });
  await act(async () => { await s.fix(pointAt(s, 0.101)); });
  await s.tick(30_000);
  await act(async () => { await s.fix(pointAt(s, 0.102)); });
  // Let a data-refresh tick observe the new disk points without advancing
  // the injected wall clock used for elapsed time.
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  const distance = s.points.rebuild(s.walk.id).snapshot().distanceM;
  // No distance may bridge the pause, even though the phone moved during it.
  expect(distance).toBeLessThan(300);
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(90));
  expect(screen.getByTestId('walk-pace')).toHaveTextContent(formatPace(paceSecPerKm(distance, 90)));
});

test('R4.13 a paused mount excludes both completed and ongoing pause time', async () => {
  const s = await scene();
  await seedMovingWalk(s);
  s.tracker.pause();
  s.clock.advance(40_000);
  s.tracker.resume();
  s.clock.advance(30_000);
  await s.fix(pointAt(s, 0.002));
  s.tracker.pause();
  s.clock.advance(80_000);
  const distance = s.points.rebuild(s.walk.id).snapshot().distanceM;
  await s.paint();
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(90));
  expect(screen.getByTestId('walk-pace')).toHaveTextContent(formatPace(paceSecPerKm(distance, 90)));
  await s.tick(20_000);
  expect(screen.getByTestId('walk-elapsed')).toHaveTextContent(formatDuration(90));
});

test('R4.9 R4.11 R4.12 twenty stationary fixes add no distance and keep good signal', async () => {
  const s = await scene();
  await s.paint();
  for (let index = 0; index < 20; index += 1) {
    await s.tick(3000);
    // Roughly one metre of jitter, always below the five-metre floor.
    await act(async () => { await s.fix(pointAt(s, index % 2 * 0.00001)); });
  }
  await s.tick(1000);
  expect(s.points.read(s.walk.id)).toHaveLength(20);
  expect(s.points.rebuild(s.walk.id).snapshot().distanceM).toBe(0);
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(0));
  expect(screen.getByTestId('walk-speed')).toHaveTextContent(speedText(0));
  expect(screen.getByTestId('walk-pace')).toHaveTextContent('--');
  expect(screen.getByTestId('walk-signal')).toHaveTextContent(strings.walks.signalGood);
  expect(screen.queryByText(strings.walks.noSignal)).toBeNull();
});

test('R4.10 09 section 6.2 a fresh inaccurate fix shows weak signal, not no signal', async () => {
  const s = await scene();
  await s.fix(pointAt(s, 0, 31));
  await s.paint();
  expect(screen.getByTestId('walk-signal')).toHaveTextContent(strings.walks.signalWeak);
  expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(0));
  expect(screen.queryByText(strings.walks.noSignal)).toBeNull();
});

test('R4.9 09 section 6.2 no signal appears only after fifteen seconds without a fix', async () => {
  const s = await scene();
  await s.fix(pointAt(s));
  await s.paint();
  expect(screen.getByTestId('walk-signal')).toHaveTextContent(strings.walks.signalGood);
  await s.tick(14_000);
  expect(screen.getByTestId('walk-signal')).toHaveTextContent(strings.walks.signalGood);
  await s.tick(2000);
  expect(screen.getByTestId('walk-signal')).toHaveTextContent(strings.walks.noSignal);
  await act(async () => { await s.fix(pointAt(s)); });
  await s.tick(1000);
  expect(screen.getByTestId('walk-signal')).toHaveTextContent(strings.walks.signalGood);
});

test('R4.14 WK-2 WK-3 finish queues one filtered simplified route and caches it before cleanup', async () => {
  const s = await scene();
  await seedUploadWalk(s);
  const raw = s.points.read(s.walk.id);
  const route = routeForUpload(raw);
  const preview = routePreview(route);
  const distance = s.points.rebuild(s.walk.id).snapshot().distanceM;
  const seconds = movingSeconds(s.walk.startedAt, s.clock.now(), 60_000);
  expect(raw.some((point) => point.acc === 500)).toBe(true);
  expect(raw.some((point) => point.paused)).toBe(true);
  expect(route.length).toBeLessThan(raw.filter((point) => point.acc <= 30 && !point.paused).length);
  expect(route.length).toBeGreaterThan(32);
  expect(preview).toHaveLength(32);
  expect(preview[0]).toEqual(route[0]?.slice(0, 2));
  expect(preview.at(-1)).toEqual(route.at(-1)?.slice(0, 2));

  expect(await finishLocalWalk(s.dependencies)).toBe(s.walk.id);

  const entries = s.driver.all<{ path: string; body: string; method: string }>(
    'SELECT path, body, method FROM outbox ORDER BY seq',
  );
  expect(entries.map(({ path }) => path)).toEqual(['/walks', `/walks/${s.walk.id}/finish`]);
  const finish = entries[1];
  expect(finish?.method).toBe('POST');
  expect(JSON.parse(finish?.body ?? 'null') as unknown).toMatchObject({
    pet_id: s.pet.id, started_at: new Date(s.walk.startedAt).toISOString(),
    ended_at: new Date(s.clock.now()).toISOString(), paused_ms: 60_000,
    distance_m: distance, duration_s: seconds,
    avg_pace_s_per_km: Math.round(paceSecPerKm(distance, seconds) ?? 0), route, preview,
  });
  expect(s.store.getState().walks[s.walk.id]).toMatchObject({
    status: 'finished', point_count: route.length, has_route: true, preview,
  });
  expect(s.walks.getRoute(s.walk.id)).toEqual(route);
  expect(s.walks.getLocal()).toBeNull();
  expect(s.points.read(s.walk.id)).toEqual([]);
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('pawlaris.walk-location');
  const reopened = await trackingStorage(s.driver.export());
  try {
    expect(reopened.walks.getRoute(s.walk.id)).toEqual(route);
    expect(reopened.walks.getLocal()).toBeNull();
    expect(reopened.points.read(s.walk.id)).toEqual([]);
    expect(reopened.outbox.count()).toBe(2);
  } finally { reopened.driver.close(); }
});

test('R4.13 R4.14 finishing during a pause saves moving time and the full paused_ms', async () => {
  const s = await scene();
  await seedMovingWalk(s);
  s.tracker.pause();
  s.clock.advance(45_000);
  s.tracker.resume();
  s.clock.advance(30_000);
  await s.fix(pointAt(s, 0.002));
  s.tracker.pause();
  s.clock.advance(70_000);
  await finishLocalWalk(s.dependencies);
  expect(s.store.getState().walks[s.walk.id]).toMatchObject({
    status: 'finished', duration_s: 90, paused_ms: 115_000,
    ended_at: new Date(s.clock.now()).toISOString(),
  });
  expect(s.walks.getLocal()).toBeNull();
});

test('R4.14 09 section 6.2 finish requires confirmation and repeated taps queue one finish', async () => {
  const s = await scene();
  await seedMovingWalk(s);
  const route = routeForUpload(s.points.read(s.walk.id));
  await s.paint();
  await fireEvent.press(screen.getByTestId('walk-finish'));
  await fireEvent.press(screen.getByTestId('walk-finish'));
  expect(s.outbox.count()).toBe(1);
  expect(s.walks.getLocal()?.id).toBe(s.walk.id);
  const sheet = screen.getByTestId('walk-finish-sheet');
  expect(within(sheet).getByText(strings.walks.finishTitle)).toBeOnTheScreen();
  const confirm = within(sheet).getByTestId('walk-finish-confirm');
  await fireEvent.press(confirm);
  await fireEvent.press(confirm);
  expect(s.outbox.count()).toBe(2);
  expect(s.walks.getRoute(s.walk.id)).toEqual(route);
  expect(s.walks.getLocal()).toBeNull();
  expect(s.points.read(s.walk.id)).toEqual([]);
  expect(s.finished).toEqual([s.walk.id]);
  expect(s.discarded()).toBe(0);
});

test('R4.14 double confirmation while finish is pending calls finish and queues it once', async () => {
  const s = await scene();
  await seedMovingWalk(s);
  let releaseFinish = () => {};
  const pending = new Promise<void>((resolve) => { releaseFinish = resolve; });
  const finish = jest.fn(async () => {
    await pending;
    return finishLocalWalk(s.dependencies);
  });
  s.services.finish = finish;
  await s.paint();
  await fireEvent.press(screen.getByTestId('walk-finish'));
  const confirm = within(screen.getByTestId('walk-finish-sheet')).getByTestId('walk-finish-confirm');
  const responder = confirm.props.onStartShouldSetResponder as {
    testOnly_pressabilityConfig(): { onPress(): Promise<void> };
  };
  const pressConfirm = responder.testOnly_pressabilityConfig().onPress;
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  try {
    // Both taps reach the enabled handler before React renders busy=true.
    await act(() => {
      first = pressConfirm();
      second = pressConfirm();
    });
    expect(finish).toHaveBeenCalledTimes(1);
    expect(s.outbox.count()).toBe(1);
    expect(s.finished).toEqual([]);
  } finally {
    await act(async () => {
      releaseFinish();
      await Promise.all([first, second]);
    });
  }
  expect(finish).toHaveBeenCalledTimes(1);
  expect(s.driver.all<{ path: string }>('SELECT path FROM outbox ORDER BY seq'))
    .toEqual([{ path: '/walks' }, { path: `/walks/${s.walk.id}/finish` }]);
  expect(s.finished).toEqual([s.walk.id]);
});

test.each([
  { reason: 'distance under twenty metres', duration: 60_000, delta: 0.0001 },
  { reason: 'duration under thirty seconds', duration: 29_000, delta: 0.001 },
])('R4.18 09 section 6.2 $reason offers discard first', async ({ duration, delta }) => {
  const s = await scene();
  await seedMovingWalk(s, duration, delta);
  await s.paint();
  await fireEvent.press(screen.getByTestId('walk-finish'));
  const sheet = screen.getByTestId('walk-finish-sheet');
  const primary = within(sheet).getAllByRole('button')[0];
  expect(primary).toHaveTextContent(strings.walks.discard);
  expect(primary).toHaveProp('testID', 'walk-discard');
  expect(s.outbox.count()).toBe(1);
  expect(s.walks.getLocal()?.id).toBe(s.walk.id);
  if (primary === undefined) throw new Error('The finish sheet has no primary action');
  await fireEvent.press(primary);
  expect(s.driver.all<{ path: string }>('SELECT path FROM outbox ORDER BY seq'))
    .toEqual([{ path: '/walks' }, { path: `/walks/${s.walk.id}/discard` }]);
  expect(s.walks.getLocal()).toBeNull();
  expect(s.points.read(s.walk.id)).toEqual([]);
  expect(s.walks.getRoute(s.walk.id)).toBeNull();
  expect(s.discarded()).toBe(1);
  expect(s.finished).toEqual([]);
});

test('09 section 6.2 thirty seconds and more than twenty metres offers finish first', async () => {
  const s = await scene();
  await seedMovingWalk(s, 30_000, 0.001);
  await s.paint();
  await fireEvent.press(screen.getByTestId('walk-finish'));
  const primary = within(screen.getByTestId('walk-finish-sheet')).getAllByRole('button')[0];
  expect(primary).toHaveTextContent(strings.walks.finish);
  expect(primary).toHaveProp('testID', 'walk-finish-confirm');
});

test('R4.18 discard queues the real discard mutation, stops tracking and removes local data', async () => {
  const s = await scene();
  await seedMovingWalk(s, 15_000, 0.00001);
  await discardLocalWalk(s.dependencies);
  expect(s.driver.all<{ path: string }>('SELECT path FROM outbox ORDER BY seq'))
    .toEqual([{ path: '/walks' }, { path: `/walks/${s.walk.id}/discard` }]);
  expect(s.store.getState().walks[s.walk.id]).toBeUndefined();
  expect(s.walks.getLocal()).toBeNull();
  expect(s.points.read(s.walk.id)).toEqual([]);
  expect(s.walks.getRoute(s.walk.id)).toBeNull();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('pawlaris.walk-location');
});

test.each(['service', 'foreground'] as const)('R4.3 09 section 6.2 banner matches %s tracking mode', async (mode) => {
  const s = await scene(mode);
  await s.fix(pointAt(s));
  expect(s.walks.getLocal()?.trackingMode).toBe(mode);
  await s.paint();
  if (mode === 'foreground') {
    expect(screen.getByTestId('walk-foreground-banner')).toHaveTextContent(strings.walks.foregroundBanner);
    await s.tick(20_000);
    expect(screen.getByTestId('walk-foreground-banner')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('walk-foreground-banner'));
    expect(s.settingsOpened()).toBe(1);
  } else {
    // Ensure a blank screen cannot satisfy the service-mode absence check.
    expect(screen.getByTestId('walk-distance')).toHaveTextContent(formatDistance(0));
    expect(screen.queryByTestId('walk-foreground-banner')).toBeNull();
    expect(screen.queryByText(strings.walks.foregroundBanner)).toBeNull();
  }
});
