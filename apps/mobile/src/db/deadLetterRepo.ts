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

  upsert(entry: DeadLetterEntry): void {
    this.driver.run(`
      INSERT OR REPLACE INTO dead_letter (
        client_mutation_id, method, path, body, status, error, created_at, failed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [entry.clientMutationId, entry.method, entry.path,
      entry.body === null ? null : JSON.stringify(entry.body),
      entry.status, entry.error, entry.createdAt, entry.failedAt]);
  }
  list(): DeadLetterEntry[] {
    return this.driver.all<Omit<DeadLetterEntry, 'body'> & { body: string | null }>(`
      SELECT client_mutation_id AS clientMutationId, method, path, body, status, error,
        created_at AS createdAt, failed_at AS failedAt
      FROM dead_letter ORDER BY failed_at, client_mutation_id
    `).map((entry) => ({
      ...entry, body: entry.body === null ? null : JSON.parse(entry.body) as unknown,
    }));
  }
  count(): number {
    return this.driver.all<{ count: number }>('SELECT COUNT(*) AS count FROM dead_letter')[0]?.count ?? 0;
  }
}
