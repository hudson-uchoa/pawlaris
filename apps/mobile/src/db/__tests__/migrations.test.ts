import { migrations } from '../migrations';
import { openDatabase } from '../open';
import { memoryDriver, type MemoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { identity } from '../../ui/tokens/color';

const columns: Record<string, string[]> = {
  replica: ['entity', 'id', 'revision', 'pending', 'deleted', 'pull_gen', 'sort_key', 'json'],
  outbox: ['seq', 'client_mutation_id', 'user_id', 'method', 'path', 'body', 'entity',
    'entity_id', 'created_at', 'attempts', 'server_errors', 'next_retry_at', 'last_error'],
  dead_letter: ['client_mutation_id', 'method', 'path', 'body', 'status', 'error',
    'created_at', 'failed_at'],
  asset_file: ['id', 'kind', 'local_uri', 'state', 'sha256', 'attempts', 'next_retry_at', 'created_at'],
  local_walk: ['id', 'pet_id', 'state', 'started_at', 'paused_ms', 'pause_started_at', 'tracking_mode'],
  walk_point: ['walk_id', 'seq', 'lat', 'lon', 't', 'acc', 'paused'],
  walk_route_cache: ['walk_id', 'points'],
  kv: ['key', 'value'],
};

let driver: MemoryDriver;
beforeEach(async () => { driver = await memoryDriver(); });
afterEach(() => driver.close());

test.each(Array.from({ length: migrations.length + 1 }, (_, version) => version))(
  'opening schema version %i reaches the latest version and every specified table',
  (version) => {
    migrations.slice(0, version).forEach((sql) => driver.run(sql));
    driver.run(`PRAGMA user_version = ${version}`);
    openDatabase(driver);
    expect(driver.all('PRAGMA user_version')).toEqual([{ user_version: migrations.length }]);
    for (const [table, names] of Object.entries(columns)) {
      expect(driver.all<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name))
        .toEqual(names);
    }
  },
);

test('Q-55 migrating legacy pets backfills a missing identity as null and preserves a chosen key', () => {
  const previousVersion = 1;
  migrations.slice(0, previousVersion).forEach((sql) => driver.run(sql));
  driver.run(`PRAGMA user_version = ${previousVersion}`);
  const factory = rowFactories({ now: () => 0 }, sequentialIds());
  const { identity_color: omittedIdentity, ...legacy } = factory.pets();
  expect(omittedIdentity).toBeNull();
  expect(legacy).not.toHaveProperty('identity_color');
  const chosen = factory.pets({ identity_color: identity[1].key });
  for (const pet of [legacy, chosen]) {
    driver.run('INSERT INTO replica (entity, id, json) VALUES (?, ?, ?)', ['pets', pet.id, JSON.stringify(pet)]);
  }

  openDatabase(driver);

  const rows = driver.all<{ id: string; json: string }>('SELECT id, json FROM replica ORDER BY id');
  expect(rows.map(({ json }) => JSON.parse(json) as unknown)).toEqual([
    { ...legacy, identity_color: null }, chosen,
  ]);
  expect(driver.all('PRAGMA user_version')).toEqual([{ user_version: migrations.length }]);
});

test('opening the latest schema again preserves existing rows', () => {
  openDatabase(driver);
  driver.run('INSERT INTO kv (key, value) VALUES (?, ?)', ['device_id', 'device-1']);
  openDatabase(driver);
  expect(driver.all('SELECT key, value FROM kv')).toEqual([{ key: 'device_id', value: 'device-1' }]);
});

test('the schema keeps replica ranges indexed and both composite primary keys', () => {
  openDatabase(driver);
  expect(driver.all('PRAGMA index_info(replica_range)')).toEqual([
    { seqno: 0, cid: 0, name: 'entity' }, { seqno: 1, cid: 6, name: 'sort_key' },
  ]);
  for (const [table, keys] of [
    ['replica', ['entity', 'id']], ['walk_point', ['walk_id', 'seq']],
  ] as const) {
    expect(driver.all<{ name: string; pk: number }>(`PRAGMA table_info(${table})`)
      .filter((column) => column.pk > 0).map((column) => column.name)).toEqual(keys);
  }
  const indexes = driver.all<{ name: string; unique: number }>('PRAGMA index_list(outbox)');
  expect(indexes.some((index) => index.unique === 1 &&
    driver.all<{ name: string }>(`PRAGMA index_info(${index.name})`)
      .some((column) => column.name === 'client_mutation_id'))).toBe(true);
});

test('a failure before user_version is written rolls back the schema and version together', () => {
  const failure = new Error('injected migration failure');
  const run = driver.run.bind(driver);
  jest.spyOn(driver, 'run').mockImplementation((sql, params) => {
    if (/PRAGMA user_version\s*=/i.test(sql)) throw failure;
    run(sql, params);
  });
  expect(() => openDatabase(driver)).toThrow(failure);
  expect(driver.all('PRAGMA user_version')).toEqual([{ user_version: 0 }]);
  expect(driver.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'"))
    .toEqual([]);
});
