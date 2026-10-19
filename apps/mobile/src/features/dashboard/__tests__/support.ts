import type { AuthUser } from '@pawlaris/shared';
import type { ConnectionState, KickReason } from '../../../sync/engine';
import { taskContext } from '../../tasks/__tests__/support';
import type { DashboardServices } from '../types';

export async function dashboardContext(role: AuthUser['role'] = 'leader') {
  const c = await taskContext(role);
  const kick = jest.fn<Promise<void>, [KickReason]>().mockResolvedValue(undefined);
  const connection: ConnectionState = { status: 'offline', server: 'primary', outboxCount: 0 };
  const marker = { dashboardInteractive: jest.fn() };
  const services: DashboardServices = {
    clock: c.clock, sessionUser: c.services.sessionUser, preferences: c.kv,
    engine: { kick, state: { getState: () => connection, subscribe: () => () => {} } },
    marker, afterFirstPaint: jest.fn(),
  };
  return { ...c, services, refresh: kick, marker,
    onAdd: jest.fn(), onManage: jest.fn(), onOpenPet: jest.fn(),
  };
}

export type DashboardContext = Awaited<ReturnType<typeof dashboardContext>>;
