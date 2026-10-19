import type { AuthUser, Family, Member } from '@pawlaris/shared';
import type { Api } from '../api/client';
import { Kv } from '../db/kv';
import type { SqlDriver } from '../db/driver';
import { accountAvailability, type AccountAction } from '../features/family/accountAvailability';
import type { FamilyActions, FamilyInvite } from '../features/family/types';
import type { IdGen } from '../platform/idGen';
import type { ReplicaApply } from '../replica/apply';
import type { ReplicaStore } from '../replica/store';
import type { ConnectionObservable, Engine } from '../sync/engine';

export class FamilyActionError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function createFamilyActions(deps: {
  api: Api;
  driver: SqlDriver;
  ids: IdGen;
  apply: ReplicaApply;
  store: ReplicaStore;
  connection: ConnectionObservable;
  sessionUser(): AuthUser | null;
  kick: Engine['kick'];
  changePassword: FamilyActions['changePassword'];
}): FamilyActions {
  const kv = new Kv(deps.driver);
  function requireOnline(action?: AccountAction): AuthUser {
    const connection = deps.connection.getState();
    if (connection.status !== 'synced' && connection.status !== 'syncing'
      || action !== undefined && accountAvailability(action, connection) !== 'available') {
      throw new FamilyActionError('unavailable');
    }
    const user = deps.sessionUser();
    if (user === null) throw new FamilyActionError('unavailable');
    const role = deps.store.getState().members[user.id]?.role ?? user.role;
    if (action !== 'name' && role !== 'leader') throw new FamilyActionError('forbidden');
    return user;
  }
  async function request(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown,
    idempotent = false): Promise<unknown> {
    const result = await deps.api.request(method, path, body,
      idempotent ? { 'Idempotency-Key': deps.ids.uuid() } : undefined);
    if ('networkError' in result || !result.ok) {
      const code = !('networkError' in result) && typeof result.body === 'object' && result.body !== null
        && 'code' in result.body && typeof result.body.code === 'string' ? result.body.code : 'unavailable';
      throw new FamilyActionError(code);
    }
    return result.body;
  }
  return {
    async patchFamily(patch) {
      requireOnline();
      const row = await request('PATCH', '/family', patch, true) as Family;
      deps.apply.applyServerRows([{ entity: 'family', row }]);
    },
    async invite(role) {
      requireOnline('invite');
      return await request('POST', '/invites', { role }) as FamilyInvite;
    },
    async changeRole(userId, role) {
      requireOnline('role');
      const row = await request('PATCH', `/family/members/${userId}`, { role }, true) as Member;
      deps.apply.applyServerRows([{ entity: 'members', row }]);
    },
    async removeMember(userId) {
      requireOnline('remove');
      const row = await request('DELETE', `/family/members/${userId}`, undefined, true) as Member;
      deps.apply.applyServerRows([{ entity: 'members', row }]);
      // Removal also unassigns tasks; the sync response carries those rows.
      void deps.kick('refresh');
    },
    async patchProfile(patch) {
      requireOnline('name');
      const user = await request('PATCH', '/me', patch) as AuthUser;
      kv.set('session_user', JSON.stringify(user));
      // /me has no revision; only /sync can supply the replicated member row.
      await deps.kick('refresh');
    },
    changePassword: deps.changePassword,
  };
}
