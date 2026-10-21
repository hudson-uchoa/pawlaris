import { haversineM, type RoutePoint } from '@pawlaris/shared';

type Pair = readonly [number, number];
export type RouteViewport = { center: [number, number]; zoom: number };

// MapLibre's unpitched Web Mercator camera uses a 512-pixel world at zoom 0.
function world([lat, lon]: Pair): Pair {
  const radians = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2];
}

export function routeViewport(points: readonly Pair[], width: number, height: number): RouteViewport {
  if (points.length === 0) return { center: [0, 0], zoom: 1 };
  const projected = points.map(world);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const zoom = Math.max(0, Math.min(17, Math.log2(Math.min(
    Math.max(1, width - 48) / Math.max(1e-9, (right - left) * 512),
    Math.max(1, height - 48) / Math.max(1e-9, (bottom - top) * 512),
  ))));
  return { center: [(left + right) / 2 * 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - top - bottom))) * 180 / Math.PI], zoom };
}

export function screenLine(points: readonly Pair[], width: number, height: number,
  viewport: RouteViewport): [number, number][] {
  const center = world([viewport.center[1], viewport.center[0]]);
  const scale = 512 * 2 ** viewport.zoom;
  return points.map((point) => {
    const [x, y] = world(point);
    return [(x - center[0]) * scale + width / 2, (y - center[1]) * scale + height / 2];
  });
}

export function previewLine(points: readonly Pair[], width: number, height: number): string {
  return screenLine(points, width, height, routeViewport(points, width, height))
    .map((pair) => pair.join(',')).join(' ');
}

export function lineLength(points: readonly Pair[]): number {
  return points.reduce((length, point, index) => {
    const previous = points[index - 1];
    return length + (previous === undefined ? 0 : Math.hypot(point[0] - previous[0], point[1] - previous[1]));
  }, 0);
}

// Clip the oldest segment so the fading tail spans at most forty metres.
export function cometTail(points: readonly RoutePoint[]): [number, number][] {
  const head = points.at(-1);
  if (head === undefined) return [];
  const tail: [number, number][] = [[head[1], head[0]]];
  let remaining = 40;
  for (let index = points.length - 2; index >= 0 && remaining > 0; index -= 1) {
    const point = points[index], next = points[index + 1];
    if (point === undefined || next === undefined) continue;
    const metres = haversineM({ lat: point[0], lon: point[1] }, { lat: next[0], lon: next[1] });
    const fraction = metres === 0 ? 1 : Math.min(1, remaining / metres);
    tail.unshift([next[1] + (point[1] - next[1]) * fraction,
      next[0] + (point[0] - next[0]) * fraction]);
    remaining -= metres;
  }
  return tail;
}
