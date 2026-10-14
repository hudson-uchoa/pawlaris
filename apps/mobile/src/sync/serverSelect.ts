import type { ApiFailure } from '../api/client';
import type { Servers } from '../config/servers';
import type { Kv, Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { Http } from '../platform/http';

// null means the cycle reached the server; offline means no network was available.
export type ServerOutcome = ApiFailure | null | 'offline';

export interface ServerSelect {
  current(): Server;
  report(outcome: ServerOutcome): Promise<void>;
  tick(): Promise<void>;
}

export interface ServerSelectDependencies {
  http: Http;
  clock: Clock;
  kv: Kv;
  servers: Servers;
}

export function createServerSelect(deps: ServerSelectDependencies): ServerSelect {
  void deps;
  return {
    current() { throw new Error('Server selection is not implemented'); },
    report(outcome) {
      void outcome;
      throw new Error('Server selection is not implemented');
    },
    tick() { throw new Error('Server selection is not implemented'); },
  };
}
