import type { SQLiteBindParams } from 'expo-sqlite';
import { expoSqliteDriver, type SqlDriver } from '../driver';
import { migrations } from '../migrations';
import { openDatabase } from '../open';
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
  let execCommands: string[];

  beforeEach(async () => {
    memory = await memoryDriver();
    commands = [];
    execCommands = [];
    const run = (sql: string, params?: unknown[]) => {
      commands.push(sql);
      memory.run(sql, params);
    };
    mockOpenDatabase.mockReset();
    mockOpenDatabase.mockReturnValue({
      execSync: (sql) => {
        execCommands.push(sql);
        run(sql);
      },
      runSync: (sql, params) => {
        // Passing params makes sql.js prepare and run only the first statement.
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

  test('opening through the driver reaches the latest version with every schema table', () => {
    openDatabase(driver);
    expect(driver.all('PRAGMA user_version')).toEqual([{ user_version: migrations.length }]);
    expect(driver.all(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT IN ('sample', 'sqlite_sequence') ORDER BY name
    `)).toEqual([
      { name: 'asset_file' }, { name: 'dead_letter' }, { name: 'kv' }, { name: 'local_walk' },
      { name: 'outbox' }, { name: 'replica' }, { name: 'walk_point' }, { name: 'walk_route_cache' },
    ]);
    if (kind === 'expo') {
      expect(execCommands).toEqual(expect.arrayContaining(migrations));
    }
  });

  test('a bound read selects exactly one of two stored rows', () => {
    driver.run('INSERT INTO sample (id, value) VALUES (?, ?)', [1, 'first']);
    driver.run('INSERT INTO sample (id, value) VALUES (?, ?)', [2, 'second']);
    expect(driver.all('SELECT id, value FROM sample WHERE value = ?', ['second']))
      .toEqual([{ id: 2, value: 'second' }]);
  });

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

  test('onTransactionEnd reports the committed rows before transaction returns', () => {
    const listener = jest.fn((committed: boolean) => {
      expect(committed).toBe(true);
      expect(driver.all('SELECT id FROM sample')).toEqual([{ id: 1 }]);
      // The outer transaction is already closed when listeners run.
      driver.run('BEGIN IMMEDIATE');
      driver.run('ROLLBACK');
    });
    driver.onTransactionEnd(listener);
    driver.transaction(() => {
      driver.run('INSERT INTO sample (id) VALUES (?)', [1]);
      expect(listener).not.toHaveBeenCalled();
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
  });

  test('onTransactionEnd reports rolled-back rows before transaction rethrows', () => {
    const listener = jest.fn((committed: boolean) => {
      expect(committed).toBe(false);
      expect(driver.all('SELECT id FROM sample')).toEqual([]);
      driver.run('BEGIN IMMEDIATE');
      driver.run('ROLLBACK');
    });
    driver.onTransactionEnd(listener);
    const failure = new Error('Injected rollback');
    expect(() => driver.transaction(() => {
      driver.run('INSERT INTO sample (id) VALUES (?)', [1]);
      expect(listener).not.toHaveBeenCalled();
      throw failure;
    })).toThrow(failure);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(false);
  });

  test('onTransactionEnd never notifies for an inner call, including a caught throw', () => {
    const listener = jest.fn();
    driver.onTransactionEnd(listener);
    driver.transaction(() => {
      driver.transaction(() => driver.run('INSERT INTO sample (id) VALUES (?)', [1]));
      expect(listener).not.toHaveBeenCalled();
      const failure = new Error('Caught inner failure');
      expect(() => driver.transaction(() => { throw failure; })).toThrow(failure);
      expect(listener).not.toHaveBeenCalled();
    });
    expect(listener.mock.calls).toEqual([[true]]);
  });

  test('onTransactionEnd notifies once when an inner throw rolls back the outer call', () => {
    const listener = jest.fn();
    driver.onTransactionEnd(listener);
    const failure = new Error('Uncaught inner failure');
    expect(() => driver.transaction(() => {
      driver.transaction(() => {
        driver.run('INSERT INTO sample (id) VALUES (?)', [1]);
        throw failure;
      });
    })).toThrow(failure);
    expect(listener.mock.calls).toEqual([[false]]);
    expect(driver.all('SELECT id FROM sample')).toEqual([]);
  });

  test('R4: an onTransactionEnd listener commits its own transaction', () => {
    let wroteFromListener = false;
    const listener = jest.fn((committed: boolean) => {
      if (!committed || wroteFromListener) return;
      wroteFromListener = true;
      driver.transaction(() => {
        driver.run('INSERT INTO sample (id, value) VALUES (?, ?)', [2, 'listener']);
      });
    });
    driver.onTransactionEnd(listener);
    driver.transaction(() => driver.run('INSERT INTO sample (id) VALUES (?)', [1]));
    // The listener's transaction has its own observable commit notification.
    expect(listener.mock.calls).toEqual([[true], [true]]);
    expect(driver.all('SELECT id, value FROM sample ORDER BY id')).toEqual([
      { id: 1, value: null }, { id: 2, value: 'listener' },
    ]);
    if (kind === 'expo') {
      expect(commands.filter((sql) => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql)))
        .toEqual(['BEGIN IMMEDIATE', 'COMMIT', 'BEGIN IMMEDIATE', 'COMMIT']);
    }

    const failure = new Error('Injected rollback after the listener commit');
    expect(() => driver.transaction(() => {
      driver.run('DELETE FROM sample');
      throw failure;
    })).toThrow(failure);
    expect(driver.all('SELECT id, value FROM sample ORDER BY id')).toEqual([
      { id: 1, value: null }, { id: 2, value: 'listener' },
    ]);
    expect(listener.mock.calls).toEqual([[true], [true], [false]]);
  });

  test('onTransactionEnd retains every listener across commits and rollbacks', () => {
    const first = jest.fn();
    const second = jest.fn();
    driver.onTransactionEnd(first);
    driver.onTransactionEnd(second);
    driver.transaction(() => driver.run('INSERT INTO sample (id) VALUES (?)', [1]));
    const failure = new Error('Injected rollback');
    expect(() => driver.transaction(() => { throw failure; })).toThrow(failure);
    driver.transaction(() => driver.run('INSERT INTO sample (id) VALUES (?)', [2]));
    expect(first.mock.calls).toEqual([[true], [false], [true]]);
    expect(second.mock.calls).toEqual([[true], [false], [true]]);
    expect(driver.all('SELECT id FROM sample ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
