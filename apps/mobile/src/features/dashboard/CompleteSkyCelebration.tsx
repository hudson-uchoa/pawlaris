import type { DateKey } from '@pawlaris/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { ShootingStars } from '../../ui/cosmos/ShootingStars';
import type { DashboardServices } from './types';

// Mounted for one completed view of today; kv survives undo and replica rebuilds.
export function CompleteSkyCelebration({ today, preferences, width, height, active }: {
  today: DateKey;
  preferences: DashboardServices['preferences'];
  width: number;
  height: number;
  active: boolean;
}): ReactElement {
  const [play] = useState(() => preferences.get('celebrated_on') !== today);
  useEffect(() => {
    if (play && active) preferences.set('celebrated_on', today);
  }, [play, active, preferences, today]);
  return <ShootingStars width={width} height={height} active={active} play={play} />;
}
