import type { AuthUser, DayViewInput } from '@pawlaris/shared';
import type { StartupMarker } from '../../perf/marker';
import type { Clock } from '../../platform/clock';
import type { Engine } from '../../sync/engine';
import type { Mutations } from '../../sync/mutations';

export type DashboardScope = DayViewInput['scope'];

export interface PhotoProofTarget {
  taskId: string;
  occurrenceKey: string;
  petId: string | null;
}

export interface DashboardServices {
  clock: Clock;
  mutations: Pick<Mutations, 'createCompletion' | 'undoCompletion' | 'startTimer'>;
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
  initialDate?: string;
  onAdd(): void;
  onManage(): void;
  onOpenPet(id: string): void;
  onOpenTask?: (taskId: string) => void;
  onPhotoRequired?: (target: PhotoProofTarget) => void;
  onOpenPhoto?: (assetId: string) => void;
}
