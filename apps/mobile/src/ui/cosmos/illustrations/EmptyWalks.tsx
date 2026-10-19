import { Circle, DashPathEffect, Group, Oval, Path } from '@shopify/react-native-skia';
import type { ReactElement } from 'react';
import { useTheme } from '../../theme';
import { illustrations } from '../../tokens/cosmos';
import { Starfield } from '../Starfield';
import type { IllustrationProps } from './types';

export function EmptyWalks({ width, height, active, testID }: IllustrationProps): ReactElement {
  const { color } = useTheme();
  const scene = illustrations.emptyWalks;
  const scale = Math.min(width / illustrations.width, height / illustrations.height);
  return <Starfield width={width} height={height} active={active} seed={illustrations.seed} fadeEdges
    {...(testID === undefined ? {} : { testID })}>
    <Group transform={[{ translateX: (width - illustrations.width * scale) / 2 },
      { translateY: (height - illustrations.height * scale) / 2 }, { scale }]}>
      <Group origin={scene.planet} transform={[{ rotate: scene.rotation }]}>
        <Oval rect={scene.orbit} style="stroke" color={color.textMuted} strokeWidth={illustrations.strokeWidth}>
          <DashPathEffect intervals={[...scene.dashes]} />
        </Oval>
        <Path path={scene.back} style="stroke" color={color.accent} strokeWidth={illustrations.strokeWidth} />
        <Circle cx={scene.planet.x} cy={scene.planet.y} r={scene.planet.radius} color={color.accentSoft} />
        <Circle cx={scene.planet.x} cy={scene.planet.y} r={scene.planet.radius}
          style="stroke" color={color.accent} strokeWidth={illustrations.strokeWidth} />
        <Path path={scene.front} style="stroke" color={color.accent} strokeWidth={illustrations.strokeWidth} />
      </Group>
    </Group>
  </Starfield>;
}
