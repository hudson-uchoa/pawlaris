import { requestHttp, type ApiFailure } from '../api/client';
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

export function createServerSelect({ http, clock, kv, servers }: ServerSelectDependencies): ServerSelect {
  let failures = 0;
  let firstFailureAt: number | null = null;
  let healthyPrimaryProbes = 0;
  let lastPrimaryProbeAt = clock.now();
  const current = (): Server => kv.get('active_server') === 'reserve' ? 'reserve' : 'primary';

  const healthy = async (server: Server, address: string): Promise<boolean> => {
    const result = await requestHttp(http, {
      method: 'GET', url: `${address.replace(/\/+$/, '')}/health`, timeoutMs: 15_000,
    });
    if ('networkError' in result || result.status !== 200) return false;
    const body = result.body;
    return typeof body === 'object' && body !== null
      && 'role' in body && body.role === server && 'status' in body && body.status === 'ok';
  };

  const move = (server: Server): void => {
    kv.set('active_server', server);
    failures = 0;
    firstFailureAt = null;
    healthyPrimaryProbes = 0;
    lastPrimaryProbeAt = clock.now();
  };

  return {
    current,
    async report(outcome) {
      if (servers.reserve === undefined || current() !== 'primary' || outcome === 'offline') return;
      if (outcome === null || !('networkError' in outcome || [502, 503, 504].includes(outcome.status))) {
        failures = 0;
        firstFailureAt = null;
        return;
      }
      failures += 1;
      firstFailureAt ??= clock.now();
      if (failures >= 3 && clock.now() - firstFailureAt >= 60_000
        && await healthy('reserve', servers.reserve)) move('reserve');
    },
    async tick() {
      if (servers.reserve === undefined || current() !== 'reserve'
        || clock.now() - lastPrimaryProbeAt < 60_000) return;
      lastPrimaryProbeAt = clock.now();
      healthyPrimaryProbes = await healthy('primary', servers.primary) ? healthyPrimaryProbes + 1 : 0;
      if (healthyPrimaryProbes >= 3) move('primary');
    },
  };
}
