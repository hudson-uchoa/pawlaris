import type { SqlDriver } from './driver';
import type { SyncEntity } from './replicaRepo';

export interface OutboxEntry {
  seq: number;
  clientMutationId: string;
  userId: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown | null;
  entity: SyncEntity;
  entityId: string;
  createdAt: number;
  attempts: number;
  serverErrors: number;
  nextRetryAt: number;
  lastError: string | null;
}
export type NewOutboxEntry = Omit<OutboxEntry,
  'seq' | 'attempts' | 'serverErrors' | 'nextRetryAt' | 'lastError'>;
export type OutboxRetry = Pick<OutboxEntry,
  'attempts' | 'serverErrors' | 'nextRetryAt' | 'lastError'>;

export class OutboxRepo {
  constructor(private readonly driver: SqlDriver) {}

  insert(_entry: NewOutboxEntry): OutboxEntry {
    throw new Error('not implemented: OutboxRepo.insert');
  }
  head(_userId: string): OutboxEntry | null {
    throw new Error('not implemented: OutboxRepo.head');
  }
  remove(_seq: number): void {
    throw new Error('not implemented: OutboxRepo.remove');
  }
  update(_seq: number, _retry: OutboxRetry): void {
    throw new Error('not implemented: OutboxRepo.update');
  }
  count(): number {
    throw new Error('not implemented: OutboxRepo.count');
  }
  hasEntryFor(_entity: SyncEntity, _id: string): boolean {
    throw new Error('not implemented: OutboxRepo.hasEntryFor');
  }
  removeForEntityId(_id: string): void {
    throw new Error('not implemented: OutboxRepo.removeForEntityId');
  }
}
