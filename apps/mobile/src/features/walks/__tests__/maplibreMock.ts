import type { ReactNode } from 'react';

// Keep domain functions, replica selectors and route loading real. Only the
// native MapLibre boundary becomes inert views, so it cannot request tiles.
jest.mock('@maplibre/maplibre-react-native', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const component = () => jest.fn((props: { children?: ReactNode }) =>
    createElement(View, props, props.children));
  return { Map: component(), Camera: component(), GeoJSONSource: component(),
    RasterSource: component(), Layer: component() };
});
