import type { Session } from '../auth/session';
import type { Servers } from '../config/servers';
import type { Server } from '../db/kv';
import type { Http, HttpHeaders, HttpMethod, HttpRequest } from '../platform/http';

export interface HttpFailure {
  ok: false;
  status: number;
  body: unknown;
  headers: HttpHeaders;
}

export interface NetworkFailure {
  networkError: true;
}

export type ApiFailure = HttpFailure | NetworkFailure;
export type ApiResult<T = unknown> = {
  ok: true;
  status: number;
  body: T;
  headers: HttpHeaders;
} | ApiFailure;

export interface Api {
  request(
    method: HttpMethod, path: string, body?: unknown, headers?: HttpHeaders,
  ): Promise<ApiResult>;
}

export interface ApiDependencies {
  http: Http;
  session: Pick<Session, 'accessToken' | 'refresh'>;
  servers: Servers;
  activeServer(): Server;
}

export async function requestHttp(http: Http, request: HttpRequest): Promise<ApiResult> {
  try {
    const response = await http.request(request);
    return { ok: response.status >= 200 && response.status < 300, ...response };
  } catch {
    return { networkError: true };
  }
}

export function createApi({ http, session, servers, activeServer }: ApiDependencies): Api {
  return {
    async request(method, path, body, headers) {
      const server = activeServer();
      const base = servers[server];
      if (base === undefined) throw new Error('The active server has no configured address');
      const token = await session.accessToken(server);
      if (typeof token !== 'string') return token;
      const callerHeaders = Object.fromEntries(
        Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization'),
      );
      const send = (accessToken: string) => requestHttp(http, {
        method, url: `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`,
        ...(body === undefined ? {} : { body }),
        headers: { ...callerHeaders, Authorization: `Bearer ${accessToken}` },
        timeoutMs: 15_000,
      });
      const result = await send(token);
      if ('networkError' in result || result.status !== 401) return result;
      const refreshed = await session.refresh(server);
      if ('networkError' in refreshed || !refreshed.ok) return refreshed;
      return send(refreshed.body.access_token);
    },
  };
}
