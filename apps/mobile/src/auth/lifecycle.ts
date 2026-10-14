import type { Api } from '../api/client';
import { requestHttp } from '../api/client';
import type { AuthUser } from '@pawlaris/shared';
import type { Servers } from '../config/servers';
import type { SqlDriver } from '../db/driver';
import { Kv, serverKey, type Server } from '../db/kv';
import { OutboxRepo } from '../db/outboxRepo';
import type { Clock } from '../platform/clock';
import type { Http } from '../platform/http';
import type { ReplicaStore } from '../replica/store';
import { hydrateReplica } from '../replica/apply';
import type { SecretBox } from './secretBox';
import type { Session, WireSession } from './session';

export interface DiscardOptions {
  confirmDiscard(count: number): Promise<boolean>;
}

export interface Lifecycle {
  onLogin(session: WireSession, options: DiscardOptions): Promise<boolean>;
  logout(options: DiscardOptions): Promise<boolean>;
  wipe(): Promise<void>;
}

export interface LifecycleDependencies {
  driver: SqlDriver;
  store: ReplicaStore;
  clock: Clock;
  session: Session;
  secretBox: SecretBox;
  api: Api;
  http: Http;
  servers: Servers;
  activeServer(): Server;
  kick(reason: 'login'): void | Promise<void>;
  removeAssetFiles(): Promise<void>;
  cancelNotifications(): Promise<void>;
  stopTracking(): Promise<void>;
}

export function createLifecycle(deps: LifecycleDependencies): Lifecycle {
  const kv = new Kv(deps.driver);
  const outbox = new OutboxRepo(deps.driver);
  const confirm = async ({ confirmDiscard }: DiscardOptions): Promise<boolean> => {
    const count = outbox.count();
    return count === 0 || await confirmDiscard(count);
  };
  const wipe = async (): Promise<void> => {
    deps.driver.transaction(() => {
      for (const table of [
        'replica', 'outbox', 'dead_letter', 'asset_file', 'local_walk', 'walk_point', 'walk_route_cache',
      ]) deps.driver.run(`DELETE FROM ${table}`);
      deps.driver.run("DELETE FROM kv WHERE key != 'device_id'");
      // Use the replica's existing writer; publish the empty store on commit.
      hydrateReplica(deps);
    });
    await deps.removeAssetFiles();
    await deps.session.clear('primary');
    await deps.session.clear('reserve');
    await deps.cancelNotifications();
    await deps.stopTracking();
  };

  return {
    async onLogin(session, options) {
      const server = deps.activeServer();
      const stored = kv.get('session_user');
      const previous = stored === null ? null : JSON.parse(stored) as AuthUser;
      if (previous !== null && previous.id !== session.user.id) {
        if (!await confirm(options)) return false;
        await wipe();
      }
      await deps.session.adopt(session, server);
      if (!deps.store.getState().ready) hydrateReplica(deps);
      void deps.kick('login');
      return true;
    },
    async logout(options) {
      if (!await confirm(options)) return false;
      const server = deps.activeServer();
      const pushToken = kv.get(serverKey('push_token_sent', server));
      if (pushToken !== null) await deps.api.request('DELETE', '/me/push-token', { token: pushToken });
      const stored = await deps.secretBox.get(`session_tokens.${server}`);
      if (stored !== null) {
        const tokens = JSON.parse(stored) as { refresh_token: string };
        const base = deps.servers[server];
        if (base === undefined) throw new Error('The active server has no configured address');
        await requestHttp(deps.http, {
          method: 'POST', url: `${base.replace(/\/+$/, '')}/auth/logout`,
          body: { refresh_token: tokens.refresh_token }, timeoutMs: 15_000,
        });
      }
      await wipe();
      return true;
    },
    wipe,
  };
}
