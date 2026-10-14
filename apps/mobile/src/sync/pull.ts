import type { Api } from '../api/client';
import type { ResultClass } from '../api/errors';
import type { SqlDriver } from '../db/driver';
import type { Server } from '../db/kv';
import type { ReplicaApply } from '../replica/apply';

export type PullResult = ResultClass;

export interface PullOptions {
  pullGen?: number;
}

export interface Pull {
  pull(options?: PullOptions): Promise<PullResult>;
}

export interface PullDependencies {
  driver: SqlDriver;
  apply: ReplicaApply;
  api: Api;
  arrive(server: Server): Promise<PullResult>;
}

export function createPull(dependencies: PullDependencies): Pull {
  void dependencies;
  return {
    async pull(options = {}) {
      void options;
      throw new Error('Pull is not implemented');
    },
  };
}
