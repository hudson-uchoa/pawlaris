import type { Asset } from '@pawlaris/shared';
import type { Session } from '../auth/session';
import type { Servers } from '../config/servers';
import type { SqlDriver } from '../db/driver';
import type { Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { FileSystem } from '../platform/fileSystem';
import type { Random } from '../platform/random';
import type { ReplicaStore } from '../replica/store';

export interface Capture {
  id: string;
  kind: Asset['kind'];
  localUri: string;
  sha256: string;
}

export type AssetFileResult =
  | { status: 'ready'; uri: string }
  | { status: 'pending' | 'failed'; uri?: undefined };

export interface Uploads {
  kick(): Promise<void>;
  dispose(): void;
}

export interface AssetFiles {
  registerCapture(capture: Capture): void;
  readonly uploads: Uploads;
  ensureFile(id: string): Promise<AssetFileResult>;
  retryUpload(id: string): void;
  prefetchAvatars(): Promise<void>;
}

export interface AssetFilesDependencies {
  driver: SqlDriver;
  store: ReplicaStore;
  fileSystem: FileSystem;
  documentDirectory: string;
  session: Pick<Session, 'accessToken' | 'refresh'>;
  servers: Servers;
  activeServer(): Server;
  clock: Clock;
  random: Random;
}

export function createAssetFiles(deps: AssetFilesDependencies): AssetFiles {
  void deps;
  return {
    registerCapture(capture) {
      void capture;
      throw new Error('not implemented');
    },
    uploads: {
      async kick() { throw new Error('not implemented'); },
      dispose() {},
    },
    async ensureFile(id) {
      void id;
      throw new Error('not implemented');
    },
    retryUpload(id) {
      void id;
      throw new Error('not implemented');
    },
    async prefetchAvatars() { throw new Error('not implemented'); },
  };
}
