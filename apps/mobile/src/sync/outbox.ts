import type { AuthUser } from '@pawlaris/shared';
import type { Api, ApiResult } from '../api/client';
import type { SqlDriver } from '../db/driver';
import type { OutboxEntry } from '../db/outboxRepo';
import type { EntityRows, SyncEntity } from '../db/replicaRepo';
import type { Clock } from '../platform/clock';
import type { Random } from '../platform/random';
import type { ReplicaApply } from '../replica/apply';
import type { SyncEvents } from './events';

export type DrainResult = 'empty' | 'waiting' | 'signed_out';

export interface Outbox {
  drain(): Promise<DrainResult>;
  onAck(entry: OutboxEntry, row: EntityRows[SyncEntity]): void;
  reject(entry: OutboxEntry, result: ApiResult): void;
}

export interface OutboxDependencies {
  driver: SqlDriver;
  apply: ReplicaApply;
  api: Api;
  clock: Clock;
  random: Random;
  sessionUser: Pick<AuthUser, 'id'>;
  events: SyncEvents;
}

export function createOutbox(_dependencies: OutboxDependencies): Outbox {
  return {
    drain() { throw new Error('not implemented'); },
    onAck(_entry, _row) { throw new Error('not implemented'); },
    reject(_entry, _result) { throw new Error('not implemented'); },
  };
}
