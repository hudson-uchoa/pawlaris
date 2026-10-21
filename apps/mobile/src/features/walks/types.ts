import type { AuthUser } from '@pawlaris/shared';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';
import type { LiveWalkServices } from '../../walks/live';

export interface WalkScreenServices {
  clock: Clock;
  sessionUser(): AuthUser | null;
  readLocalWalk: LiveWalkServices['readLocalWalk'];
  mutations: Pick<Mutations, 'discardWalk'>;
}
