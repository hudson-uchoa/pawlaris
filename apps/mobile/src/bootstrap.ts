import type { AuthUser } from '@pawlaris/shared';
import type { SecretBox } from './auth/secretBox';
import type { Session } from './auth/session';
import type { Servers } from './config/servers';
import type { SqlDriver } from './db/driver';
import type { Clock } from './platform/clock';
import type { FileSystem } from './platform/fileSystem';
import type { Http } from './platform/http';
import type { IdGen } from './platform/idGen';
import type { Random } from './platform/random';
import type { ReplicaStore } from './replica/store';
import type { Engine } from './sync/engine';
import type { SyncEvents } from './sync/events';
import type { SocketConnection } from './sync/socket';

export interface AppDependencies {
  driver: SqlDriver;
  clock: Clock;
  http: Http;
  secretBox: SecretBox;
  random: Random;
  ids: IdGen;
  fileSystem: FileSystem;
  servers: Servers;
  WebSocketImpl: new (url: string) => SocketConnection;
  online: boolean;
}

export interface AppRuntime {
  db: SqlDriver;
  store: ReplicaStore;
  engine: Engine;
  session: Session;
  events: SyncEvents;
  clock: Clock;
  sessionUser(): AuthUser | null;
  afterFirstPaint(): void;
  dispose(): void;
}

export function createAppRuntime(dependencies: AppDependencies): AppRuntime {
  void dependencies;
  throw new Error('App runtime not implemented');
}

export function productionDependencies(): AppDependencies {
  throw new Error('Production app dependencies not implemented');
}
