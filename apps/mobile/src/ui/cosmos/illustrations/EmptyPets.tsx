import { Circle, DashPathEffect, Group, Path } from '@shopify/react-native-skia';
import type { ReactElement } from 'react';
import { useTheme } from '../../theme';
import { illustrations } from '../../tokens/cosmos';
import { Starfield } from '../Starfield';
import type { IllustrationProps } from './types';

export function EmptyPets({ width, height, active, testID }: IllustrationProps): ReactElement {
  const { color } = useTheme();
  const scene = illustrations.emptyPets;
  const scale = Math.min(width / illustrations.width, height / illustrations.height);
  return <Starfield width={width} height={height} active={active} seed={illustrations.seed} fadeEdges
    {...(testID === undefined ? {} : { testID })}>
    <Group transform={[{ translateX: (width - illustrations.width * scale) / 2 },
      { translateY: (height - illustrations.height * scale) / 2 }, { scale }]}>
      <Path path={scene.pad} style="stroke" color={color.textMuted}
        strokeWidth={illustrations.strokeWidth} strokeCap="round" strokeJoin="round">
        <DashPathEffect intervals={[...scene.dots]} />
      </Path>
      {scene.toes.map((toe) => <Circle key={toe.x} cx={toe.x} cy={toe.y} r={toe.radius}
        style="stroke" color={color.textMuted} strokeWidth={illustrations.strokeWidth} strokeCap="round">
        <DashPathEffect intervals={[...scene.dots]} />
      </Circle>)}
    </Group>
  </Starfield>;
}
