import './maplibreMock';
import { Map } from '@maplibre/maplibre-react-native';
import { routeForUpload, routePreview } from '@pawlaris/shared';
import { cleanup, render, type RenderResult } from '@testing-library/react-native';
import { ReplicaProvider } from '../../../replica/useReplica';
import { historyContext, type HistoryContext } from '../../../walks/__tests__/historySupport';
import { WalkRoutesProvider } from '../../../walks/useWalkRoute';
import { RouteThumbnail } from '../RouteThumbnail';

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

function coordinates(rendered: RenderResult): number[] {
  // react-native-svg renders a Polyline as one native SVG path. Inspect the
  // real path output rather than replacing SVG or its projection with a mock.
  const lines = rendered.container.queryAll((node) => node.type === 'RNSVGPath');
  expect(lines).toHaveLength(1);
  const value: unknown = lines[0]?.props.d;
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') throw new Error('The native SVG path must contain the preview line');
  return value.replace(/^M/, '').trim().split(/[\s,]+/).map(Number);
}

test('09 section 6.1 thumbnail draws its SVG from preview with no route or tile request', async () => {
  const route = routeForUpload([
    { lat: -23.55, lon: -46.63, t: c.clock.now(), acc: 4, paused: false },
    { lat: -23.55, lon: -46.629, t: c.clock.now() + 60_000, acc: 4, paused: false },
    { lat: -23.549, lon: -46.629, t: c.clock.now() + 120_000, acc: 4, paused: false },
  ]);
  const preview = routePreview(route);
  expect(preview).toHaveLength(3);
  const walk = c.seedWalk({ status: 'finished', has_route: true, point_count: route.length, preview });
  expect(c.walks.getRoute(walk.id)).toBeNull();
  const view = (value: typeof preview) => <ReplicaProvider store={c.store}>
    <WalkRoutesProvider routes={c.routes}>
      <RouteThumbnail preview={value} width={120} height={80} />
    </WalkRoutesProvider>
  </ReplicaProvider>;
  const rendered = await render(view(walk.preview));
  const drawn = coordinates(rendered);
  expect(drawn).toHaveLength(preview.length * 2);
  expect(drawn.every(Number.isFinite)).toBe(true);
  // East then north: the SVG preserves the supplied preview's corner.
  expect(drawn[0]).toBeLessThan(drawn[2] ?? NaN);
  expect(drawn[1]).toBeCloseTo(drawn[3] ?? NaN);
  expect(drawn[2]).toBeCloseTo(drawn[4] ?? NaN);
  expect(drawn[3]).toBeGreaterThan(drawn[5] ?? NaN);

  await rendered.rerender(view(preview.slice(0, 2)));
  expect(coordinates(rendered)).toHaveLength(4);
  expect(c.http.requests).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(Map).not.toHaveBeenCalled();
  expect(c.walks.getRoute(walk.id)).toBeNull();
});
