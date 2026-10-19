import type { ConnectionState } from '../../sync/engine';

export type AccountAction = 'invite' | 'name' | 'password' | 'role' | 'remove';
export type AccountAvailability = 'available' | 'offline' | 'reserve';

export function accountAvailability(
  _action: AccountAction, connection: ConnectionState,
): AccountAvailability {
  if (connection.status !== 'synced' && connection.status !== 'syncing') return 'offline';
  return connection.server === 'reserve' ? 'reserve' : 'available';
}
