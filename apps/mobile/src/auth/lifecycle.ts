import type { Api } from '../api/client';
import type { Servers } from '../config/servers';
import type { SqlDriver } from '../db/driver';
import type { Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { Http } from '../platform/http';
import type { ReplicaStore } from '../replica/store';
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
  void deps;
  throw new Error('Session lifecycle not implemented');
}
