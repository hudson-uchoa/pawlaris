import type { Api } from '../api/client';
import type { Session } from '../auth/session';
import type { SqlDriver } from '../db/driver';
import type { Server } from '../db/kv';
import type { SyncEntity } from '../db/replicaRepo';
import type { Clock } from '../platform/clock';
import type { FileSystem } from '../platform/fileSystem';
import type { ReplicaApply } from '../replica/apply';
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

export function createArrive(_deps: ArriveDependencies): Arrive {
  return {
    async arrive(_server) {
      throw new Error('Arrive not implemented');
    },
  };
}
