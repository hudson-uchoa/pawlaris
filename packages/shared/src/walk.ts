export type Position = { lat: number; lon: number };
export type WalkPoint = Position & { t: number; acc: number; paused: boolean };
export type RoutePoint = [lat: number, lon: number, t: number, acc: number];
export type WalkSnapshot = {
  distanceM: number;
  countedPosition: WalkPoint | null;
  pointCount: number;
};
export type WalkAccumulator = {
  add(point: WalkPoint): void;
  snapshot(): WalkSnapshot;
};

export function haversineM(a: Position, b: Position): number {
  void a; void b;
  throw new Error('not implemented');
}

export function createAccumulator(): WalkAccumulator {
  throw new Error('not implemented');
}

export function movingSeconds(startedAt: number, now: number, pausedMs: number): number {
  void startedAt; void now; void pausedMs;
  throw new Error('not implemented');
}

export function paceSecPerKm(distanceM: number, movingS: number): number | null {
  void distanceM; void movingS;
  throw new Error('not implemented');
}

export function currentSpeedMps(points: readonly WalkPoint[]): number {
  void points;
  throw new Error('not implemented');
}

export function simplifyRoute(points: readonly WalkPoint[], toleranceM: number): WalkPoint[] {
  void points; void toleranceM;
  throw new Error('not implemented');
}

export function routeForUpload(points: readonly WalkPoint[]): RoutePoint[] {
  void points;
  throw new Error('not implemented');
}

export function routePreview(points: readonly RoutePoint[]): [lat: number, lon: number][] {
  void points;
  throw new Error('not implemented');
}
