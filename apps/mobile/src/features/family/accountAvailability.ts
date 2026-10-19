import type { ConnectionState } from '../../sync/engine';

export type AccountAction = 'invite' | 'name' | 'password' | 'role' | 'remove';
export type AccountAvailability = 'available' | 'offline' | 'reserve';

export function accountAvailability(
  _action: AccountAction, _connection: ConnectionState,
): AccountAvailability {
  throw new Error('not implemented');
}
