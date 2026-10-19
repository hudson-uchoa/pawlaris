// Use Reanimated's Jest implementation and animation matchers.
require('react-native-reanimated').setUpTests();

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
