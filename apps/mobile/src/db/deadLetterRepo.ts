import type { SqlDriver } from './driver';
import type { OutboxEntry } from './outboxRepo';

export interface DeadLetterEntry extends Pick<OutboxEntry,
  'clientMutationId' | 'method' | 'path' | 'body' | 'createdAt'> {
  status: number;
  error: string;
  failedAt: number;
}

export class DeadLetterRepo {
  constructor(private readonly driver: SqlDriver) {}

  upsert(_entry: DeadLetterEntry): void {
    throw new Error('not implemented: DeadLetterRepo.upsert');
  }
  list(): DeadLetterEntry[] {
    throw new Error('not implemented: DeadLetterRepo.list');
  }
  count(): number {
    throw new Error('not implemented: DeadLetterRepo.count');
  }
}
