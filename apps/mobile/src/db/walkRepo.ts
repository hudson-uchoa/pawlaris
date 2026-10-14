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
    return this.driver.all<LocalWalk>(`
      SELECT id, pet_id AS petId, state, started_at AS startedAt, paused_ms AS pausedMs,
        pause_started_at AS pauseStartedAt, tracking_mode AS trackingMode
      FROM local_walk ORDER BY started_at, id LIMIT 1
    `)[0] ?? null;
  }
  upsertLocal(walk: LocalWalk): void {
    this.driver.run(`
      INSERT OR REPLACE INTO local_walk (
        id, pet_id, state, started_at, paused_ms, pause_started_at, tracking_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [walk.id, walk.petId, walk.state, walk.startedAt, walk.pausedMs,
      walk.pauseStartedAt, walk.trackingMode]);
  }
  removeLocal(id: string): void {
    this.driver.run('DELETE FROM local_walk WHERE id = ?', [id]);
  }
  insertPoint(point: WalkPoint): void {
    this.driver.run(`
      INSERT INTO walk_point (walk_id, seq, lat, lon, t, acc, paused)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [point.walkId, point.seq, point.lat, point.lon, point.t, point.acc, Number(point.paused)]);
  }
  points(walkId: string): WalkPoint[] {
    return this.driver.all<Omit<WalkPoint, 'paused'> & { paused: number }>(`
      SELECT walk_id AS walkId, seq, lat, lon, t, acc, paused
      FROM walk_point WHERE walk_id = ? ORDER BY seq
    `, [walkId]).map((point) => ({ ...point, paused: point.paused === 1 }));
  }
  removePoints(walkId: string): void {
    this.driver.run('DELETE FROM walk_point WHERE walk_id = ?', [walkId]);
  }
  getRoute(walkId: string): RoutePoint[] | null {
    const stored = this.driver.all<{ points: string }>(
      'SELECT points FROM walk_route_cache WHERE walk_id = ?', [walkId],
    )[0];
    return stored === undefined ? null : JSON.parse(stored.points) as RoutePoint[];
  }
  upsertRoute(route: CachedRoute): void {
    this.driver.run('INSERT OR REPLACE INTO walk_route_cache (walk_id, points) VALUES (?, ?)',
      [route.walkId, JSON.stringify(route.points)]);
  }
  listRoutes(): CachedRoute[] {
    return this.driver.all<{ walkId: string; points: string }>(`
      SELECT walk_id AS walkId, points FROM walk_route_cache ORDER BY walk_id
    `).map((route) => ({ walkId: route.walkId, points: JSON.parse(route.points) as RoutePoint[] }));
  }
  removeRoute(walkId: string): void {
    this.driver.run('DELETE FROM walk_route_cache WHERE walk_id = ?', [walkId]);
  }
}
