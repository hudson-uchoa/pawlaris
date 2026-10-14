import initSqlJs, { type BindParams, type SqlValue } from 'sql.js';
import type { SqlDriver } from '../db/driver';

export interface MemoryDriver extends SqlDriver {
  export(): Uint8Array;
  close(): void;
}

function bindValues(params: unknown[]): BindParams {
  return params.map((value): SqlValue => {
    if (value === null || typeof value === 'number' || typeof value === 'string'
      || value instanceof Uint8Array) {
      return value;
    }
    throw new TypeError('Unsupported SQLite parameter');
  });
}

export async function memoryDriver(data?: Uint8Array): Promise<MemoryDriver> {
  const sqlite = await initSqlJs();
  const database = new sqlite.Database(data);
  let inTransaction = false;
  const listeners: ((committed: boolean) => void)[] = [];
  return {
    run(sql, params) {
      if (params === undefined) database.run(sql);
      else database.run(sql, bindValues(params));
    },
    all<T>(sql: string, params: unknown[] = []): T[] {
      const statement = database.prepare(sql);
      try {
        statement.bind(bindValues(params));
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally {
        statement.free();
      }
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) return fn();
      database.run('BEGIN IMMEDIATE');
      inTransaction = true;
      let committed = false;
      try {
        const result = fn();
        database.run('COMMIT');
        committed = true;
        return result;
      } catch (error) {
        database.run('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
        for (const listener of listeners) listener(committed);
      }
    },
    onTransactionEnd(listener) {
      listeners.push(listener);
    },
    export: () => database.export(),
    close: () => database.close(),
  };
}
