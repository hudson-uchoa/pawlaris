import { openDatabaseSync, type SQLiteBindValue } from 'expo-sqlite';

export interface SqlDriver {
  run(sql: string, params?: unknown[]): void;
  all<T>(sql: string, params?: unknown[]): T[];
  transaction<T>(fn: () => T): T;
}

export function expoSqliteDriver(): SqlDriver {
  const database = openDatabaseSync('pawlaris.db');
  let inTransaction = false;
  const bindValues = (params: unknown[]): SQLiteBindValue[] => params.map((value) => {
    if (value === null || typeof value === 'number' || typeof value === 'string'
      || value instanceof Uint8Array) return value;
    throw new TypeError('Unsupported SQLite parameter');
  });
  const driver: SqlDriver = {
    run(sql, params) {
      if (params === undefined) database.execSync(sql);
      else database.runSync(sql, bindValues(params));
    },
    all<T>(sql: string, params: unknown[] = []): T[] {
      return database.getAllSync<T>(sql, bindValues(params));
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) return fn();
      driver.run('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = fn();
        driver.run('COMMIT');
        return result;
      } catch (error) {
        driver.run('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
  return driver;
}
