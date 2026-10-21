import type { RoutePoint } from '@pawlaris/shared';
import { Camera, GeoJSONSource, Layer, Map, Marker, type StyleSpecification } from '@maplibre/maplibre-react-native';
import { useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { strings } from '../../i18n/strings';
import { duration } from '../../ui/motion/tokens';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { useReduceMotion } from '../../ui/motion/useReduceMotion';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { CometHead } from './CometHead';
import { SavedRoute } from './SavedRoute';
import { cometTail, routeViewport, screenLine } from './routeGeometry';
import { WALK_TILE_URL } from './tiles';

export interface WalkMapProps {
  points: readonly RoutePoint[];
  mode: 'live' | 'detail';
  active: boolean;
}

export function WalkMap({ points, mode, active: focused }: WalkMapProps): ReactElement {
  const { color } = useTheme();
  const active = useAnimationActive(focused);
  const reduced = useReduceMotion();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: window.width, height: spacing.xxl * 5 });
  const [drawn, setDrawn] = useState(false);
  const coordinates = useMemo(() => points.map(([lat, lon]): [number, number] => [lon, lat]), [points]);
  const pairs = useMemo(() => points.map(([lat, lon]): [number, number] => [lat, lon]), [points]);
  const viewport = useMemo(() => routeViewport(pairs, size.width, size.height), [pairs, size]);
  const head = points.at(-1);
  const lon = head?.[1], lat = head?.[0];
  const center = useMemo<[number, number]>(() => [lon ?? 0, lat ?? 0], [lon, lat]);
  const tail = useMemo(() => cometTail(points), [points]);
  const projected = useMemo(() => screenLine(pairs, size.width, size.height, viewport), [pairs, size, viewport]);
  const mapStyle = useMemo<StyleSpecification>(() => ({
    version: 8,
    transition: { duration: 0, delay: 0 },
    sources: { osm: { type: 'raster', tiles: [WALK_TILE_URL], tileSize: 256,
      attribution: strings.walks.attribution, maxzoom: 19 } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': color.bg } },
      { id: 'tiles', type: 'raster', source: 'osm', paint: { 'raster-fade-duration': 0 } }],
  }), [color.bg]);
  const revealing = mode === 'detail' && points.length > 1 && !drawn && active && !reduced;
  return <View testID="walk-map" style={{ flex: mode === 'live' ? 1 : undefined,
    minHeight: spacing.xxl * 5, backgroundColor: color.bg }} onLayout={({ nativeEvent }) => {
    const { width, height } = nativeEvent.layout;
    if (width > 0 && height > 0) setSize((previous) => previous.width === width && previous.height === height
      ? previous : { width, height });
  }}>
    <Map testID="walk-map-native" style={StyleSheet.absoluteFill} mapStyle={mapStyle} attribution
      logo={false} touchPitch={false} touchRotate={false} dragPan={active && !revealing} touchZoom={active && !revealing}
      doubleTapZoom={active && !revealing} doubleTapHoldZoom={active && !revealing}>
      <Camera center={mode === 'live' ? center : viewport.center}
        zoom={mode === 'live' && head !== undefined ? 16 : viewport.zoom} bearing={0} pitch={0}
        duration={mode === 'live' && active && !reduced ? duration.quick : 0}
        easing={mode === 'live' && active && !reduced ? 'ease' : undefined} />
      {coordinates.length > 1 && <GeoJSONSource id="walk-route"
        data={{ type: 'LineString', coordinates }}>
        <Layer id="walk-route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': color.accent, 'line-width': 4, 'line-opacity': revealing ? 0 : 1 }} />
      </GeoJSONSource>}
      {mode === 'live' && active && !reduced && tail.length > 1 && <GeoJSONSource id="walk-tail"
        data={{ type: 'LineString', coordinates: tail }} lineMetrics>
        <Layer id="walk-tail-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-width': 6, 'line-gradient': ['interpolate', ['linear'], ['line-progress'],
            0, 'transparent', 1, color.star] }} />
      </GeoJSONSource>}
      {mode === 'live' && head !== undefined && <Marker id="walk-head" lngLat={center}>
        <CometHead fix={head[2]} active={active} />
      </Marker>}
    </Map>
    {mode === 'detail' && points.length > 1 && !drawn && <SavedRoute points={projected}
      width={size.width} height={size.height} active={active} onDrawn={() => { setDrawn(true); }} />}
    <View style={{ position: 'absolute', bottom: spacing.xs, right: spacing.xs,
      backgroundColor: color.bg, paddingHorizontal: spacing.xs }} pointerEvents="none">
      <Text variant="caption">{strings.walks.attribution}</Text>
    </View>
  </View>;
}
