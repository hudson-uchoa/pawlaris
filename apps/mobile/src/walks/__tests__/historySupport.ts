import type { AuthUser, Walk } from '@pawlaris/shared';
import { AppState } from 'react-native';
import { wireSession } from '../../auth/__tests__/support';
import { WalkRepo } from '../../db/walkRepo';
import { dashboardContext } from '../../features/dashboard/__tests__/support';
import type { WalkScreenServices } from '../../features/walks/types';
import { createWalkRoutes } from '../routes';

export async function historyContext(role: AuthUser['role'] = 'leader') {
  const c = await dashboardContext(role);
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  // taskContext advances past its inherited access token's expiry. These
  // route tests need a valid session so their queued failure reaches the GET.
  await c.session.adopt({ ...wireSession('primary'),
    access_expires_at: new Date(c.clock.now() + 900_000).toISOString() });
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
    dispose() { AppState.currentState = previousAppState; c.dispose(); },
    onStart: jest.fn<void, [string]>(), onResume: jest.fn<void, []>(),
    onOpenWalk: jest.fn<void, [string]>(), onDiscarded: jest.fn<void, []>(),
    onRequestLocation: jest.fn<void, []>(), onOpenSettings: jest.fn<void, []>(),
  };
}

export type HistoryContext = Awaited<ReturnType<typeof historyContext>>;
