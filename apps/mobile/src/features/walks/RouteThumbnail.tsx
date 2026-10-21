import type { Walk } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export interface RouteThumbnailProps {
  preview: Walk['preview'];
  width: number;
  height: number;
}

export function RouteThumbnail(_props: RouteThumbnailProps): ReactElement {
  throw new Error('not implemented');
}
