import type { components } from '../../../../packages/shared/src/api-types';
import type { ApiFailure, ApiResult } from '../api/client';
import type { Servers } from '../config/servers';
import type { Kv, Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { Http } from '../platform/http';
import type { SecretBox } from './secretBox';

export type WireSession = components['schemas']['Session'];
export type Login = components['schemas']['Login'];
export type Redeem = components['schemas']['Redeem'];

export interface Session {
  login(body: Login): Promise<ApiResult<WireSession>>;
  redeem(body: Redeem): Promise<ApiResult<WireSession>>;
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

export function createSession(_dependencies: SessionDependencies): Session {
  throw new Error('createSession is not implemented');
}
