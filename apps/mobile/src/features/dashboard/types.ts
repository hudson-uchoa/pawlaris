import type { AuthUser, DayViewInput } from '@pawlaris/shared';
import type { StartupMarker } from '../../perf/marker';
import type { Clock } from '../../platform/clock';
import type { Engine } from '../../sync/engine';

export type DashboardScope = DayViewInput['scope'];

export interface DashboardServices {
  clock: Clock;
  sessionUser(): AuthUser | null;
  preferences: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  engine: Pick<Engine, 'kick' | 'state'>;
  marker: StartupMarker;
  afterFirstPaint(): void;
}

export interface DashboardScreenProps {
  services: DashboardServices;
  active: boolean;
  onAdd(): void;
  onManage(): void;
  onOpenPet(id: string): void;
}
