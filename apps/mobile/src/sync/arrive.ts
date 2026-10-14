import type { Api } from '../api/client';
import { classify } from '../api/errors';
import type { Session } from '../auth/session';
import { AssetRepo } from '../db/assetRepo';
import type { SqlDriver } from '../db/driver';
import { Kv, serverKey, type Server } from '../db/kv';
import { ReplicaRepo, type ReseedCursor, type SyncEntity } from '../db/replicaRepo';
import { WalkRepo, type RoutePoint } from '../db/walkRepo';
import type { Clock } from '../platform/clock';
import type { FileSystem } from '../platform/fileSystem';
import { hydrateReplica, type ReplicaApply, type ServerChange } from '../replica/apply';
import type { ReplicaStore } from '../replica/store';
import type { Pull, PullResult } from './pull';

export interface Arrive {
  arrive(server: Server): Promise<PullResult>;
}

export interface ArriveDependencies {
  driver: SqlDriver;
  apply: ReplicaApply;
  store: ReplicaStore;
  clock: Clock;
  api: Api;
  session: Pick<Session, 'hasSession'>;
  pull: Pick<Pull, 'pull'>;
  fileSystem: Pick<FileSystem, 'exists'>;
  logRejectedRow(entity: SyncEntity | 'walk_routes', id: string): void;
}

type ReseedRow = ServerChange | {
  entity: 'walk_routes'; row: { walk_id: string; points: RoutePoint[] };
};

export function createArrive(deps: ArriveDependencies): Arrive {
  const kv = new Kv(deps.driver);
  const replica = new ReplicaRepo(deps.driver);
  const walks = new WalkRepo(deps.driver);
  const assets = new AssetRepo(deps.driver);

  const send = async (rows: ReseedRow[]): Promise<PullResult> => {
    const result = await deps.api.request('POST', '/reseed', { rows });
    if (!('networkError' in result) && result.status === 422) {
      if (rows.length === 1) {
        const change = rows[0];
        if (change !== undefined) deps.logRejectedRow(change.entity,
          change.entity === 'walk_routes' ? change.row.walk_id : change.row.id);
      } else {
        for (const change of rows) {
          const retry = await send([change]);
          if (retry !== 'ok') return retry;
        }
      }
      return 'ok';
    }
    return classify(result);
  };

  return {
    async arrive(server) {
      kv.set('active_server', server);
      if (!await deps.session.hasSession(server)) return 'auth';
      const since = kv.get(serverKey('last_revision', server)) ?? '0';
      const read = await deps.api.request('GET', `/sync?since=${since}&limit=1`);
      if ('networkError' in read || !read.ok) return classify(read);
      // The epoch read uses the same successful /sync shape as pull.
      const { epoch } = read.body as { epoch: string };
      let after: ReseedCursor | null = null;
      for (;;) {
        const page = replica.pageForReseed(after, 500);
        const last = page.at(-1);
        if (last === undefined) break;
        // ReplicaRepo decodes the JSON with its entity's row type.
        const result = await send(page.map(({ entity, row }) => ({ entity, row } as ServerChange)));
        if (result !== 'ok') return result;
        after = { entity: last.entity, id: last.id };
      }
      const routes = walks.listRoutes();
      for (let offset = 0; offset < routes.length; offset += 500) {
        const result = await send(routes.slice(offset, offset + 500).map(({ walkId, points }) => ({
          entity: 'walk_routes', row: { walk_id: walkId, points },
        })));
        if (result !== 'ok') return result;
      }
      const pullGen = Number(kv.get('pull_gen') ?? 0) + 1;
      deps.driver.transaction(() => {
        kv.set(serverKey('reseeded_epoch', server), epoch);
        kv.set(serverKey('last_revision', server), '0');
        kv.set('pull_gen', String(pullGen));
      });
      const result = await deps.pull.pull({ pullGen });
      if (result !== 'ok') return result;
      deps.driver.transaction(() => {
        replica.sweepUnmarked(pullGen);
        hydrateReplica(deps);
      });
      for (const file of assets.list()) {
        if (file.localUri === null || replica.get('assets', file.id) !== null
          || !await deps.fileSystem.exists(file.localUri)) continue;
        deps.driver.transaction(() => {
          const current = assets.get(file.id);
          if (current !== null) assets.upsert({ ...current, state: 'to_upload' });
        });
      }
      return 'ok';
    },
  };
}
