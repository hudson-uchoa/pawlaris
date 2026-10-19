import type { AuthUser } from '@pawlaris/shared';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';

export interface TaskScreenServices {
  clock: Clock;
  sessionUser(): AuthUser;
  mutations: Pick<Mutations, 'createTask' | 'patchTask' | 'forkTask' | 'deleteTask'>;
}

export type TaskScreenProps = {
  services: TaskScreenServices;
  active: boolean;
};
