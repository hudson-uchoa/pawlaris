import type { SQLiteBindParams } from 'expo-sqlite';
import { expoSqliteDriver, type SqlDriver } from '../driver';
import { memoryDriver, type MemoryDriver } from '../../testing/memoryDriver';

interface NativeBridge {
  execSync(sql: string): void;
  runSync(sql: string, params: SQLiteBindParams): { changes: number; lastInsertRowId: number };
  getAllSync<T>(sql: string, params: SQLiteBindParams): T[];
}
const mockOpenDatabase = jest.fn<NativeBridge, [string]>();
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (name: string) => mockOpenDatabase(name),
}));

describe.each(['memory', 'expo'] as const)('%s SqlDriver', (kind) => {
  let memory: MemoryDriver;
  let driver: SqlDriver;
  let commands: string[];

  beforeEach(async () => {
    memory = await memoryDriver();
    commands = [];
    const run = (sql: string, params: unknown[] = []) => {
      commands.push(sql);
      memory.run(sql, params);
    };
    mockOpenDatabase.mockReset();
    mockOpenDatabase.mockReturnValue({
      execSync: (sql) => run(sql),
      runSync: (sql, params) => {
        run(sql, Array.isArray(params) ? params : Object.values(params));
        return { changes: 1, lastInsertRowId: 1 };
      },
      getAllSync: <T>(sql: string, params: SQLiteBindParams): T[] =>
        memory.all<T>(sql, Array.isArray(params) ? params : Object.values(params)),
    });
    driver = kind === 'memory' ? memory : expoSqliteDriver();
    driver.run('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT, blob BLOB)');
  });
  afterEach(() => memory.close());

  test('bound values round-trip without interpolating SQL', () => {
    driver.run('INSERT INTO sample (id, value, blob) VALUES (?, ?, ?)',
      [1, "Aurora's '; DROP TABLE sample; --", new Uint8Array([1, 2])]);
    expect(driver.all('SELECT id, value, blob FROM sample')).toEqual([
      { id: 1, value: "Aurora's '; DROP TABLE sample; --", blob: new Uint8Array([1, 2]) },
    ]);
    expect(driver.all('SELECT id FROM sample WHERE value = ?', ['missing'])).toEqual([]);
  });

  test('null parameters survive a round-trip and all accepts omitted params', () => {
    driver.run('INSERT INTO sample (id, value) VALUES (?, ?)', [1, null]);
    expect(driver.all('SELECT value FROM sample')).toEqual([{ value: null }]);
  });

  test('transaction commits synchronously and returns the callback result', () => {
    const result = driver.transaction(() => {
      driver.run('INSERT INTO sample (id, value) VALUES (?, ?)', [1, 'first']);
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(driver.all('SELECT value FROM sample')).toEqual([{ value: 'first' }]);
    if (kind === 'expo') {
      expect(commands.filter((sql) => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql)))
        .toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
      expect(mockOpenDatabase).toHaveBeenCalledWith('pawlaris.db');
    }
  });

  test('transaction is re-entrant and the inner call joins the outer commit', () => {
    const result = driver.transaction(() => {
      driver.run('INSERT INTO sample (id) VALUES (?)', [1]);
      return driver.transaction(() => {
        driver.run('INSERT INTO sample (id) VALUES (?)', [2]);
        return 42;
      });
    });
    expect(result).toBe(42);
    expect(driver.all('SELECT id FROM sample ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]);
    if (kind === 'expo') {
      expect(commands.filter((sql) => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql)))
        .toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    }
  });

  test('an inner throw rolls back every write of the outer transaction', () => {
    const failure = new Error('injected inner failure');
    expect(() => driver.transaction(() => {
      driver.run('INSERT INTO sample (id) VALUES (?)', [1]);
      driver.transaction(() => {
        driver.run('INSERT INTO sample (id) VALUES (?)', [2]);
        throw failure;
      });
    })).toThrow(failure);
    expect(driver.all('SELECT id FROM sample')).toEqual([]);
    driver.transaction(() => driver.run('INSERT INTO sample (id) VALUES (?)', [3]));
    expect(driver.all('SELECT id FROM sample')).toEqual([{ id: 3 }]);
    if (kind === 'expo') {
      expect(commands.filter((sql) => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql)))
        .toEqual(['BEGIN IMMEDIATE', 'ROLLBACK', 'BEGIN IMMEDIATE', 'COMMIT']);
    }
  });

  test('an outer throw preserves previously committed rows', () => {
    driver.run('INSERT INTO sample (id) VALUES (?)', [1]);
    const failure = new Error('injected outer failure');
    expect(() => driver.transaction(() => {
      driver.run('DELETE FROM sample');
      throw failure;
    })).toThrow(failure);
    expect(driver.all('SELECT id FROM sample')).toEqual([{ id: 1 }]);
  });

  test('an exported database reopens with its committed values', async () => {
    driver.run('INSERT INTO sample (id, value) VALUES (?, ?)', [1, 'persisted']);
    const reopened = await memoryDriver(memory.export());
    try {
      expect(reopened.all('SELECT id, value FROM sample')).toEqual([{ id: 1, value: 'persisted' }]);
    } finally {
      reopened.close();
    }
  });
});
