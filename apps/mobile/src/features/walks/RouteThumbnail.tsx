import type { Walk } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '../../ui/theme';
import { previewLine } from './routeGeometry';

export interface RouteThumbnailProps {
  preview: Walk['preview'];
  width: number;
  height: number;
}

export function RouteThumbnail({ preview, width, height }: RouteThumbnailProps): ReactElement {
  const { color } = useTheme();
  return <Svg width={width} height={height} accessible={false}>
    <Polyline points={previewLine(preview, width, height)} fill="none"
      stroke={color.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
