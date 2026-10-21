import type { AuthUser, Walk } from '@pawlaris/shared';
import { WalkRepo } from '../../db/walkRepo';
import { dashboardContext } from '../../features/dashboard/__tests__/support';
import type { WalkScreenServices } from '../../features/walks/types';
import { createWalkRoutes } from '../routes';

export async function historyContext(role: AuthUser['role'] = 'leader') {
  const c = await dashboardContext(role);
  const walks = new WalkRepo(c.driver);
  const services: WalkScreenServices = {
    clock: c.clock, sessionUser: c.services.sessionUser,
    readLocalWalk: () => walks.getLocal(), mutations: c.mutations,
  };
  const routes = createWalkRoutes(c);
  function seedWalk(overrides: Partial<Walk> = {}): Walk {
    const walk = c.factory.walk_sessions({ user_id: c.sessionUser.id, ...overrides });
    c.apply.applyServerRows([{ entity: 'walk_sessions', row: walk }]);
    return walk;
  }
  return { ...c, dashboardServices: c.services, services, walks, routes, seedWalk,
    onStart: jest.fn<void, [string]>(), onResume: jest.fn<void, []>(),
    onOpenWalk: jest.fn<void, [string]>(), onDiscarded: jest.fn<void, []>(),
    onRequestLocation: jest.fn<void, []>(), onOpenSettings: jest.fn<void, []>(),
  };
}

export type HistoryContext = Awaited<ReturnType<typeof historyContext>>;
