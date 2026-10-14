import type { Session } from '../auth/session';
import type { Servers } from '../config/servers';
import type { Server } from '../db/kv';
import type { Http, HttpHeaders, HttpMethod } from '../platform/http';

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

export function createApi(_dependencies: ApiDependencies): Api {
  throw new Error('createApi is not implemented');
}
