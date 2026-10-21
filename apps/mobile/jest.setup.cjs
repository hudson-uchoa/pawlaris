const { jest: jestRuntime } = require('@jest/globals');

// Use Reanimated's Jest implementation and animation matchers.
require('react-native-reanimated').setUpTests();

// The native map boundary cannot load a renderer or request tiles in Jest.
jestRuntime.mock('@maplibre/maplibre-react-native', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  const component = () => jestRuntime.fn((props) => createElement(View, props, props.children));
  return { Map: component(), Camera: component(), GeoJSONSource: component(),
    RasterSource: component(), Layer: component(), Marker: component() };
});

// FlashList 2.0.2's setup replaces FlashList with an unexported RecyclerView.
// Keep the real component and the setup's native measurement mocks.
jestRuntime.mock('@shopify/flash-list', () => jestRuntime.requireActual('@shopify/flash-list'));

// The Skia environment loads CanvasKit outside Jest's VM. Its shader API
// checks instanceof against that realm's Array/Float32Array constructors.
// Bridge colours into that realm while retaining real shader/picture drawing.
const CanvasFloat32Array = global.CanvasKit.Color(0, 0, 0, 1).constructor;
for (const [name, colorIndex] of [['MakeLinearGradient', 2], ['MakeRadialGradient', 2]]) {
  const makeShader = global.CanvasKit.Shader[name];
  global.CanvasKit.Shader[name] = (...args) => {
    const colors = args[colorIndex];
    args[colorIndex] = new CanvasFloat32Array(typeof colors[0] === 'number'
      ? colors : Array.from(colors).flatMap((color) => Array.from(color)));
    return makeShader(...args);
  };
}
