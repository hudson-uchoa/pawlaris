import type { RoutePoint } from '@pawlaris/shared';
import type { Api } from '../api/client';
import type { SqlDriver } from '../db/driver';
import { WalkRepo } from '../db/walkRepo';

export type WalkRouteResult = { status: 'ready'; points: RoutePoint[] }
  | { status: 'unavailable'; points?: undefined };

export interface WalkRoutes {
  ensureRoute(walkId: string): Promise<WalkRouteResult>;
}

export interface WalkRoutesDependencies {
  driver: SqlDriver;
  api: Api;
}

export function createWalkRoutes(deps: WalkRoutesDependencies): WalkRoutes {
  const repo = new WalkRepo(deps.driver);
  return {
    async ensureRoute(walkId) {
      const cached = repo.getRoute(walkId);
      if (cached !== null) return { status: 'ready', points: cached };
      const result = await deps.api.request('GET', `/walks/${walkId}/route`);
      if ('networkError' in result || !result.ok) return { status: 'unavailable' };
      // GET /walks/{id}/route returns full route tuples (04 section 12).
      const route = result.body as { points: RoutePoint[] };
      deps.driver.transaction(() => { repo.upsertRoute({ walkId, points: route.points }); });
      return { status: 'ready', points: route.points };
    },
  };
}
