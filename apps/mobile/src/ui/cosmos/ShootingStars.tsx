import type { ReactElement } from 'react';

// Draw nodes are composed inside Starfield's canvas.
export type ShootingStarsProps = {
  width: number;
  height: number;
  play: boolean;
  active: boolean;
};

export function ShootingStars(props: ShootingStarsProps): ReactElement | null {
  void props;
  throw new Error('ShootingStars is not implemented');
}
