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

type StoredEntry = Omit<OutboxEntry, 'body'> & { body: string | null };
const columns = `
  seq, client_mutation_id AS clientMutationId, user_id AS userId,
  method, path, body, entity, entity_id AS entityId, created_at AS createdAt,
  attempts, server_errors AS serverErrors, next_retry_at AS nextRetryAt,
  last_error AS lastError
`;

export class OutboxRepo {
  constructor(private readonly driver: SqlDriver) {}

  insert(entry: NewOutboxEntry): OutboxEntry {
    return this.driver.transaction(() => {
      this.driver.run(`
        INSERT INTO outbox (
          client_mutation_id, user_id, method, path, body, entity, entity_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [entry.clientMutationId, entry.userId, entry.method, entry.path,
        entry.body === null ? null : JSON.stringify(entry.body),
        entry.entity, entry.entityId, entry.createdAt]);
      const seq = this.driver.all<{ seq: number }>('SELECT last_insert_rowid() AS seq')[0]?.seq;
      if (seq === undefined) throw new Error('SQLite did not return an outbox sequence');
      return { ...entry, seq, attempts: 0, serverErrors: 0, nextRetryAt: 0, lastError: null };
    });
  }
  head(userId: string): OutboxEntry | null {
    const stored = this.driver.all<StoredEntry>(
      `SELECT ${columns} FROM outbox WHERE user_id = ? ORDER BY seq LIMIT 1`, [userId],
    )[0];
    if (stored === undefined) return null;
    return { ...stored, body: stored.body === null ? null : JSON.parse(stored.body) as unknown };
  }
  remove(seq: number): void {
    this.driver.run('DELETE FROM outbox WHERE seq = ?', [seq]);
  }
  update(seq: number, retry: OutboxRetry): void {
    this.driver.run(`
      UPDATE outbox SET attempts = ?, server_errors = ?, next_retry_at = ?, last_error = ?
      WHERE seq = ?
    `, [retry.attempts, retry.serverErrors, retry.nextRetryAt, retry.lastError, seq]);
  }
  count(): number {
    return this.driver.all<{ count: number }>('SELECT COUNT(*) AS count FROM outbox')[0]?.count ?? 0;
  }
  hasEntryFor(entity: SyncEntity, id: string): boolean {
    return this.driver.all(
      'SELECT 1 FROM outbox WHERE entity = ? AND entity_id = ? LIMIT 1', [entity, id],
    ).length > 0;
  }
  removeForEntityId(id: string): void {
    this.driver.run('DELETE FROM outbox WHERE entity_id = ?', [id]);
  }
}
