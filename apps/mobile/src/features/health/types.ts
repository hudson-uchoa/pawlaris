import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';

export type HealthScreenProps = {
  services: {
    clock: Clock;
    mutations: Pick<Mutations, 'createHealthEvent' | 'patchHealthEvent' | 'deleteHealthEvent'>;
  };
  active: boolean;
  attachmentAssetId?: string;
  onAttachment(mode: 'attachment'): void;
  onClose(): void;
};
