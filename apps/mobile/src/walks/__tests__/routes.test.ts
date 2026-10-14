import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { deferred, response, servers } from '../../auth/__tests__/support';
import { WalkRepo, type RoutePoint } from '../../db/walkRepo';
import type { HttpResponse } from '../../platform/http';
import { syncContext, type SyncContext } from '../../sync/__tests__/support';
import { createWalkRoutes, type WalkRoutes } from '../routes';
import { useWalkRoute, WalkRoutesProvider } from '../useWalkRoute';

let c: SyncContext;
let routes: WalkRoutes;
let repo: WalkRepo;

function points(): RoutePoint[] {
  return [[0, 0, c.clock.now(), 5], [0.001, 0.001, c.clock.now() + 3_000, 5]];
}

beforeEach(async () => {
  jest.useFakeTimers();
  c = await syncContext();
  repo = new WalkRepo(c.driver);
  routes = createWalkRoutes({ driver: c.driver, api: c.api });
});

afterEach(() => {
  c.driver.close();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('route cache hit: return locally recorded points without making a request', async () => {
  const walkId = c.ids.uuid();
  const recorded = points();
  repo.upsertRoute({ walkId, points: recorded });
  expect(await routes.ensureRoute(walkId)).toEqual({ status: 'ready', points: recorded });
  expect(c.http.requests).toHaveLength(0);
});

test('route cache miss: fetch full points, persist them and reuse the cache', async () => {
  const walkId = c.ids.uuid();
  const recorded = points();
  c.http.enqueue(response(200, { points: recorded }));
  expect(await routes.ensureRoute(walkId)).toEqual({ status: 'ready', points: recorded });
  expect(repo.getRoute(walkId)).toEqual(recorded);
  expect(c.http.requests).toEqual([{
    method: 'GET', url: `${servers.primary}/walks/${walkId}/route`,
    headers: { Authorization: 'Bearer fake-primary-access-initial' }, timeoutMs: 15_000,
  }]);
  expect(await routes.ensureRoute(walkId)).toEqual({ status: 'ready', points: recorded });
  expect(c.http.requests).toHaveLength(1);
});

test('route offline: return unavailable and leave the cache empty', async () => {
  const walkId = c.ids.uuid();
  c.http.enqueue(new Error('Simulated offline request'));
  expect(await routes.ensureRoute(walkId)).toEqual({ status: 'unavailable' });
  expect(repo.getRoute(walkId)).toBeNull();
});

test.each([404, 503])('route failed %i: return unavailable and leave the cache empty', async (status) => {
  const walkId = c.ids.uuid();
  c.http.enqueue(response(status));
  expect(await routes.ensureRoute(walkId)).toEqual({ status: 'unavailable' });
  expect(repo.getRoute(walkId)).toBeNull();
});

test('route cache hit offline: an empty saved route remains a cache hit', async () => {
  const walkId = c.ids.uuid();
  repo.upsertRoute({ walkId, points: [] });
  expect(await routes.ensureRoute(walkId)).toEqual({ status: 'ready', points: [] });
  expect(c.http.requests).toHaveLength(0);
});

test('useWalkRoute: expose pending while loading and ready with the full route', async () => {
  const walkId = c.ids.uuid();
  const recorded = points();
  const pending = deferred<HttpResponse>();
  c.http.enqueue(() => pending.promise);
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(WalkRoutesProvider, { routes }, children);
  }
  const rendered = await renderHook(() => useWalkRoute(walkId), { wrapper: Wrapper });
  try {
    expect(rendered.result.current).toEqual({ status: 'pending' });
    await act(async () => { pending.resolve(response(200, { points: recorded })); });
    expect(rendered.result.current).toEqual({ status: 'ready', points: recorded });
  } finally {
    pending.resolve(response(200, { points: recorded }));
    await rendered.unmount();
  }
});

test('useWalkRoute offline: expose unavailable while leaving walk metrics in the replica', async () => {
  const walk = c.factory.walk_sessions({ status: 'finished', distance_m: 125, duration_s: 60 });
  c.apply.applyServerRows([{ entity: 'walk_sessions', row: walk }]);
  c.http.enqueue(new Error('Simulated offline request'));
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(WalkRoutesProvider, { routes }, children);
  }
  const rendered = await renderHook(() => useWalkRoute(walk.id), { wrapper: Wrapper });
  try {
    expect(rendered.result.current).toEqual({ status: 'unavailable' });
    expect(c.store.getState().walks[walk.id]).toEqual(walk);
  } finally {
    await rendered.unmount();
  }
});

test('useWalkRoute missing provider: report the missing route service', async () => {
  await expect(renderHook(() => useWalkRoute(c.ids.uuid())))
    .rejects.toThrow('useWalkRoute requires a WalkRoutesProvider');
});

test('useWalkRoute changed id: ignore an old pending request after moving to another walk', async () => {
  const firstId = c.ids.uuid();
  const nextId = c.ids.uuid();
  const oldPoints = points();
  const nextPoints: RoutePoint[] = [[1, 1, c.clock.now(), 5]];
  const pending = deferred<HttpResponse>();
  c.http.enqueue(() => pending.promise, response(200, { points: nextPoints }));
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(WalkRoutesProvider, { routes }, children);
  }
  const rendered = await renderHook(({ id }: { id: string }) => useWalkRoute(id), {
    initialProps: { id: firstId }, wrapper: Wrapper,
  });
  try {
    await rendered.rerender({ id: nextId });
    expect(rendered.result.current).toEqual({ status: 'ready', points: nextPoints });
    await act(async () => { pending.resolve(response(200, { points: oldPoints })); });
    expect(rendered.result.current).toEqual({ status: 'ready', points: nextPoints });
  } finally {
    pending.resolve(response(200, { points: oldPoints }));
    await rendered.unmount();
  }
});
