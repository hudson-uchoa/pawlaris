import type { Api } from '../api/client';
import type { SqlDriver } from '../db/driver';
import type { RoutePoint } from '../db/walkRepo';

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
  void deps;
  return {
    async ensureRoute(walkId) {
      void walkId;
      throw new Error('not implemented');
    },
  };
}
