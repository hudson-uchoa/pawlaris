import type { Api, ApiFailure } from '../api/client';
import { classify, type ResultClass } from '../api/errors';
import type { SqlDriver } from '../db/driver';
import { Kv, serverKey, type Server } from '../db/kv';
import type { ReplicaApply, ServerChange } from '../replica/apply';

export type PullResult = ResultClass;

export interface PullOptions {
  pullGen?: number;
}

export interface Pull {
  readonly lastFailure: ApiFailure | null;
  pull(options?: PullOptions): Promise<PullResult>;
}

export interface PullDependencies {
  driver: SqlDriver;
  apply: ReplicaApply;
  api: Api;
  arrive(server: Server): Promise<PullResult>;
  prefetchAvatars?(): Promise<void>;
  afterAppliedChanges?(): void;
}

interface PullPage {
  changes: ServerChange[];
  revision: number;
  has_more: boolean;
  epoch: string;
}

export function createPull({ driver, apply, api, arrive, prefetchAvatars, afterAppliedChanges }: PullDependencies): Pull {
  const kv = new Kv(driver);
  let lastFailure: ApiFailure | null = null;
  let arrivalPending: Server | null = null;
  const finishArrival = async (server: Server): Promise<PullResult> => {
    arrivalPending = server;
    const result = await arrive(server);
    if (result === 'ok') arrivalPending = null;
    return result;
  };
  return {
    get lastFailure() { return lastFailure; },
    async pull(options = {}) {
      lastFailure = null;
      let applied = false;
      try {
        for (;;) {
          const server = kv.get('active_server') === 'reserve' ? 'reserve' : 'primary';
          // Arrival's own full pull must enter the page loop, not delegate to itself.
          if (arrivalPending === server && options.pullGen === undefined) return finishArrival(server);
          const since = kv.get(serverKey('last_revision', server)) ?? '0';
          const result = await api.request('GET', `/sync?since=${since}&limit=500`);
          if ('networkError' in result || !result.ok) {
            lastFailure = result;
            return classify(result);
          }
          // The successful /sync body has the page shape specified in 04 section 6.
          const page = result.body as PullPage;
          if (page.epoch !== kv.get(serverKey('reseeded_epoch', server))) return finishArrival(server);
          const epochKey = serverKey('sync_epoch', server);
          if (kv.get(epochKey) === null) kv.set(epochKey, page.epoch);
          apply.applyServerRows(page.changes, { ...options, cursor: page.revision });
          applied ||= page.changes.length > 0;
          if (!page.has_more) {
            if (options.pullGen !== undefined) arrivalPending = null;
            return 'ok';
          }
        }
      } finally {
        if (applied) {
          kv.remove('suppressed_reminders');
          afterAppliedChanges?.();
          void prefetchAvatars?.();
        }
      }
    },
  };
}
