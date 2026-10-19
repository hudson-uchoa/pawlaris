import { Group, Line, Path } from '@shopify/react-native-skia';
import type { ReactElement } from 'react';
import { useTheme } from '../../theme';
import { illustrations } from '../../tokens/cosmos';
import { starPath } from '../glyphs';
import { Starfield } from '../Starfield';
import type { IllustrationProps } from './types';

export function EmptyHealth({ width, height, active, testID }: IllustrationProps): ReactElement {
  const { color } = useTheme();
  const scene = illustrations.emptyHealth;
  const scale = Math.min(width / illustrations.width, height / illustrations.height);
  return <Starfield width={width} height={height} active={active} seed={illustrations.seed} fadeEdges
    {...(testID === undefined ? {} : { testID })}>
    <Group transform={[{ translateX: (width - illustrations.width * scale) / 2 },
      { translateY: (height - illustrations.height * scale) / 2 }, { scale }]}>
      <Path path={starPath(scene.star.x, scene.star.y, scene.star.radius)} color={color.star} />
      <Line p1={scene.horizon.from} p2={scene.horizon.to} color={color.textMuted}
        strokeWidth={illustrations.strokeWidth} strokeCap="round" />
    </Group>
  </Starfield>;
}
