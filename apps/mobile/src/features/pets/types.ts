import type { AuthUser } from '@pawlaris/shared';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';

export interface PetScreenServices {
  clock: Clock;
  sessionUser(): AuthUser;
  mutations: Pick<Mutations, 'createPet' | 'patchPet' | 'archivePet' | 'unarchivePet'>;
}

export type PetScreenProps = {
  services: PetScreenServices;
  active: boolean;
};
