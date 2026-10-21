import './maplibreMock';
import { cleanup, render, screen } from '@testing-library/react-native';
import { formatDistance, formatDuration, formatPace, formatTime } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import { historyContext, type HistoryContext } from '../../../walks/__tests__/historySupport';
import { WalkRoutesProvider } from '../../../walks/useWalkRoute';
import { WalkDetailScreen } from '../WalkDetailScreen';

let c: HistoryContext;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden'));
  c = await historyContext();
});

afterEach(async () => {
  await cleanup();
  c.dispose();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('R4.16 09 section 6.3 unavailable route shows offline copy and all stored detail metrics', async () => {
  const dog = c.seedPet({ name: 'Katarina', species: 'dog' });
  const endedAt = c.clock.now();
  const startedAt = endedAt - 1_800_000;
  const walk = c.seedWalk({ pet_id: dog.id, status: 'finished',
    started_at: new Date(startedAt).toISOString(), ended_at: new Date(endedAt).toISOString(),
    distance_m: 2140, duration_s: 1800, avg_pace_s_per_km: 855,
    has_route: true, point_count: 3, note: 'Evening walk' });
  expect(c.walks.getRoute(walk.id)).toBeNull();
  c.http.enqueue(new Error('Simulated offline route request'));

  await render(<ReplicaProvider store={c.store}>
    <WalkRoutesProvider routes={c.routes}>
      <WalkDetailScreen walkId={walk.id} services={c.services} active onDiscarded={c.onDiscarded} />
    </WalkRoutesProvider>
  </ReplicaProvider>);

  // Replica metrics must be readable even while the route area is loading.
  expect(screen.getByText(formatDistance(2140))).toBeOnTheScreen();
  expect(screen.getByText(formatDuration(1800))).toBeOnTheScreen();
  expect(screen.getByText(formatPace(855))).toBeOnTheScreen();
  expect(screen.getByText(formatTime(startedAt, 'America/Sao_Paulo'), { exact: false })).toBeOnTheScreen();
  expect(screen.getByText(formatTime(endedAt, 'America/Sao_Paulo'), { exact: false })).toBeOnTheScreen();
  expect(screen.getByText('Hudson', { exact: false })).toBeOnTheScreen();
  expect(screen.getByText('Evening walk')).toBeOnTheScreen();
  expect(await screen.findByText(strings.walks.routeUnavailable)).toBeOnTheScreen();
  expect(screen.getByText(formatDistance(2140))).toBeOnTheScreen();
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]).toMatchObject({ method: 'GET',
    url: expect.stringContaining(`/walks/${walk.id}/route`) });
  expect(c.store.getState().walks[walk.id]).toEqual(walk);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
