import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { deferred, response } from '../../../auth/__tests__/support';
import { formatDistance } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import type { HttpResponse } from '../../../platform/http';
import { ReplicaProvider } from '../../../replica/useReplica';
import { historyContext, type HistoryContext } from '../../../walks/__tests__/historySupport';
import { WalkRoutesProvider } from '../../../walks/useWalkRoute';
import { WalkDetailScreen } from '../WalkDetailScreen';
import { WalksScreen } from '../WalksScreen';

let c: HistoryContext;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  c = await historyContext();
});

afterEach(async () => {
  await cleanup();
  c.dispose();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each(['walker', 'leader', 'other member'] as const)(
  'R4.18 detail discard is local and durable for the %s permission', async (viewer) => {
    if (viewer !== 'leader') { c.dispose(); c = await historyContext('member'); }
    const walk = c.seedWalk({ status: 'finished', has_route: false,
      user_id: viewer === 'walker' ? c.sessionUser.id : c.other.id });
    await render(<ReplicaProvider store={c.store}>
      <WalkDetailScreen walkId={walk.id} services={c.services} active onDiscarded={c.onDiscarded} />
    </ReplicaProvider>);
    if (viewer === 'other member') {
      expect(screen.queryByTestId('walk-discard')).toBeNull();
      expect(c.outbox.count()).toBe(0);
    } else {
      await fireEvent.press(screen.getByTestId('walk-discard'));
      expect(c.onDiscarded).toHaveBeenCalledTimes(1);
      expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'POST', path: `/walks/${walk.id}/discard` });
      expect(c.store.getState().walks[walk.id]).toBeUndefined();
      expect(screen.queryByTestId('walk-discard')).toBeNull();
    }
    expect(c.http.requests).toEqual([]);
  },
);

test('R4.17 R4.18 the leader discards an interrupted walk from history without HTTP', async () => {
  const walk = c.seedWalk({ user_id: c.other.id,
    started_at: new Date(c.clock.now() - 13 * 3_600_000).toISOString() });
  await render(<ReplicaProvider store={c.store}>
    <WalksScreen services={c.services} active locationState="granted" onStart={c.onStart}
      onResume={c.onResume} onOpenWalk={c.onOpenWalk} onRequestLocation={c.onRequestLocation}
      onOpenSettings={c.onOpenSettings} />
  </ReplicaProvider>);
  await fireEvent.press(within(screen.getByTestId(`walk-row-${walk.id}`)).getByText(strings.walks.discard));
  expect(screen.queryByTestId(`walk-row-${walk.id}`)).toBeNull();
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ path: `/walks/${walk.id}/discard` });
  expect(c.http.requests).toEqual([]);
});

test('R4.16 detail paints metrics before the deferred route resolves and caches its result', async () => {
  const walk = c.seedWalk({ status: 'finished', has_route: true, distance_m: 2140 });
  const pending = deferred<HttpResponse>();
  c.http.enqueue(() => pending.promise);
  await render(<ReplicaProvider store={c.store}>
    <WalkRoutesProvider routes={c.routes}>
      <WalkDetailScreen walkId={walk.id} services={c.services} active onDiscarded={c.onDiscarded} />
    </WalkRoutesProvider>
  </ReplicaProvider>);
  expect(screen.getByText(formatDistance(2140))).toBeOnTheScreen();
  expect(screen.getByTestId('walk-route-loading')).toBeOnTheScreen();
  const points = [[0, 0, 1000, 4], [0.001, 0, 4000, 4]];
  pending.resolve(response(200, { points }));
  expect(await screen.findByTestId('walk-map')).toBeOnTheScreen();
  expect(screen.queryByTestId('walk-route-loading')).toBeNull();
  expect(c.walks.getRoute(walk.id)).toEqual(points);
  expect(screen.getByText(formatDistance(2140))).toBeOnTheScreen();
  expect(c.http.requests).toHaveLength(1);
});
