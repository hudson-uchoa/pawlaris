import { Group, Path } from '@shopify/react-native-skia';
import type { ReactElement } from 'react';
import { useTheme } from '../../theme';
import { illustrations } from '../../tokens/cosmos';
import { crescentPath, starPath } from '../glyphs';
import { Starfield } from '../Starfield';
import type { IllustrationProps } from './types';

export function ClearSky({ width, height, active, testID }: IllustrationProps): ReactElement {
  const { color } = useTheme();
  const scene = illustrations.clearSky;
  const scale = Math.min(width / illustrations.width, height / illustrations.height);
  return <Starfield width={width} height={height} active={active} seed={illustrations.seed}
    {...(testID === undefined ? {} : { testID })}>
    <Group transform={[{ translateX: (width - illustrations.width * scale) / 2 },
      { translateY: (height - illustrations.height * scale) / 2 }, { scale }]}>
      <Path path={crescentPath(scene.crescent.x, scene.crescent.y, scene.crescent.radius)} color={color.textMuted} />
      {scene.stars.map((star) => <Path key={star.x} path={starPath(star.x, star.y, star.radius)} color={color.star} />)}
    </Group>
  </Starfield>;
}
