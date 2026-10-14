import type { components } from '../../../../packages/shared/src/api-types';
import { requestHttp, type ApiFailure, type ApiResult } from '../api/client';
import type { Servers } from '../config/servers';
import { serverKey, type Kv, type Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { Http } from '../platform/http';
import type { SecretBox } from './secretBox';

export type WireSession = components['schemas']['Session'];
export type Login = components['schemas']['Login'];
export type Redeem = components['schemas']['Redeem'];

export interface Session {
  login(body: Login): Promise<ApiResult<WireSession>>;
  redeem(body: Redeem): Promise<ApiResult<WireSession>>;
  adopt(session: WireSession, server?: Server): Promise<void>;
  accessToken(server?: Server): Promise<string | ApiFailure>;
  refresh(server?: Server): Promise<ApiResult<WireSession>>;
  clear(server?: Server): Promise<void>;
}

export interface SessionDependencies {
  http: Http;
  secretBox: SecretBox;
  clock: Clock;
  kv: Kv;
  servers: Servers;
  activeServer(): Server;
}

type StoredTokens = Pick<WireSession, 'access_token' | 'refresh_token' | 'access_expires_at'>;

const tokenKey = (server: Server): string => `session_tokens.${server}`;

export function createSession({ http, secretBox, clock, kv, servers, activeServer }: SessionDependencies): Session {
  const flights = new Map<Server, Promise<ApiResult<WireSession>>>();

  const signedOut = (server: Server): ApiFailure => {
    kv.set(serverKey('signed_out', server), '1');
    return {
      ok: false, status: 401, headers: {},
      body: {
        type: 'about:blank', title: 'Unauthorized', status: 401,
        code: 'token_invalid', detail: 'No usable session exists for this server.',
      },
    };
  };

  const storedTokens = async (server: Server): Promise<StoredTokens | null> => {
    const stored = await secretBox.get(tokenKey(server));
    return stored === null ? null : JSON.parse(stored) as StoredTokens;
  };

  const adopt = async (wire: WireSession, server: Server = activeServer()): Promise<void> => {
    const tokens: StoredTokens = {
      access_token: wire.access_token, refresh_token: wire.refresh_token,
      access_expires_at: wire.access_expires_at,
    };
    await secretBox.set(tokenKey(server), JSON.stringify(tokens));
    kv.set('session_user', JSON.stringify(wire.user));
    kv.remove(serverKey('signed_out', server));
  };

  const authenticate = async (
    server: Server, path: string, body: Login | Redeem | components['schemas']['Refresh'],
  ): Promise<ApiResult<WireSession>> => {
    const base = servers[server];
    if (base === undefined) throw new Error('The active server has no configured address');
    const result = await requestHttp(http, {
      method: 'POST', url: `${base.replace(/\/+$/, '')}${path}`, body, timeoutMs: 15_000,
    });
    if ('networkError' in result || !result.ok) return result;
    return { ...result, body: result.body as WireSession };
  };

  const performRefresh = async (server: Server): Promise<ApiResult<WireSession>> => {
    if (kv.get(serverKey('signed_out', server)) === '1') return signedOut(server);
    const tokens = await storedTokens(server);
    if (tokens === null) return signedOut(server);
    const result = await authenticate(server, '/auth/refresh', { refresh_token: tokens.refresh_token });
    if (!('networkError' in result) && result.ok) await adopt(result.body, server);
    if (!('networkError' in result) && result.status === 401) {
      kv.set(serverKey('signed_out', server), '1');
    }
    return result;
  };

  const refresh = (server: Server = activeServer()): Promise<ApiResult<WireSession>> => {
    const running = flights.get(server);
    if (running !== undefined) return running;
    const pending = performRefresh(server).finally(() => { flights.delete(server); });
    flights.set(server, pending);
    return pending;
  };

  return {
    login: (body) => authenticate(activeServer(), '/auth/login', body),
    redeem: (body) => authenticate(activeServer(), '/auth/redeem', body),
    adopt,
    async accessToken(server = activeServer()) {
      if (kv.get(serverKey('signed_out', server)) === '1') return signedOut(server);
      const tokens = await storedTokens(server);
      if (tokens !== null && Date.parse(tokens.access_expires_at) - clock.now() > 30_000) {
        return tokens.access_token;
      }
      const result = await refresh(server);
      return 'networkError' in result || !result.ok ? result : result.body.access_token;
    },
    refresh,
    clear: (server = activeServer()) => secretBox.del(tokenKey(server)),
  };
}
