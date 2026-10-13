export interface SqlDriver {
  run(sql: string, params?: unknown[]): void;
  all<T>(sql: string, params?: unknown[]): T[];
  transaction<T>(fn: () => T): T;
}

export function expoSqliteDriver(): SqlDriver {
  throw new Error('not implemented: expoSqliteDriver');
}
