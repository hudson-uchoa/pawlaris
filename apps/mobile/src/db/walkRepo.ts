import type { SqlDriver } from './driver';

export interface LocalWalk {
  id: string;
  petId: string;
  state: 'active' | 'paused';
  startedAt: number;
  pausedMs: number;
  pauseStartedAt: number | null;
  trackingMode: 'service' | 'foreground';
}
export interface WalkPoint {
  walkId: string;
  seq: number;
  lat: number;
  lon: number;
  t: number;
  acc: number;
  paused: boolean;
}
export type RoutePoint = [number, number, number, number];
export interface CachedRoute {
  walkId: string;
  points: RoutePoint[];
}

export class WalkRepo {
  constructor(private readonly driver: SqlDriver) {}

  getLocal(): LocalWalk | null {
    throw new Error('not implemented: WalkRepo.getLocal');
  }
  upsertLocal(_walk: LocalWalk): void {
    throw new Error('not implemented: WalkRepo.upsertLocal');
  }
  removeLocal(_id: string): void {
    throw new Error('not implemented: WalkRepo.removeLocal');
  }
  insertPoint(_point: WalkPoint): void {
    throw new Error('not implemented: WalkRepo.insertPoint');
  }
  points(_walkId: string): WalkPoint[] {
    throw new Error('not implemented: WalkRepo.points');
  }
  removePoints(_walkId: string): void {
    throw new Error('not implemented: WalkRepo.removePoints');
  }
  getRoute(_walkId: string): RoutePoint[] | null {
    throw new Error('not implemented: WalkRepo.getRoute');
  }
  upsertRoute(_route: CachedRoute): void {
    throw new Error('not implemented: WalkRepo.upsertRoute');
  }
  listRoutes(): CachedRoute[] {
    throw new Error('not implemented: WalkRepo.listRoutes');
  }
  removeRoute(_walkId: string): void {
    throw new Error('not implemented: WalkRepo.removeRoute');
  }
}
