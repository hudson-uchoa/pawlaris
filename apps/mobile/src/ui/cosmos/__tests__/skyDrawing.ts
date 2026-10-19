import type { SkColor, SkRSXform } from '@shopify/react-native-skia';
import type { render } from '@testing-library/react-native';
import type { SharedValue } from 'react-native-reanimated';

type RenderedView = Awaited<ReturnType<typeof render>>;

export function atlasTransforms(view: RenderedView): SkRSXform[] {
  const atlas = view.container.queryAll((node) => node.type === 'skAtlas')[0];
  if (atlas === undefined) throw new Error('Missing sky atlas');
  return (atlas.props.transforms as SharedValue<SkRSXform[]>).get();
}

export function atlasColors(view: RenderedView): SkColor[] {
  const atlas = view.container.queryAll((node) => node.type === 'skAtlas')[0];
  if (atlas === undefined) throw new Error('Missing sky atlas');
  return (atlas.props.colors as SharedValue<SkColor[]>).get();
}

export function atlasAlphas(view: RenderedView): number[] {
  return atlasColors(view).map((color) => color[3] ?? 0);
}
