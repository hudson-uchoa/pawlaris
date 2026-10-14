import { AssetRepo } from '../assetRepo';
import { DeadLetterRepo } from '../deadLetterRepo';
import { Kv, serverKey, type ServerKeyName } from '../kv';
import { openDatabase } from '../open';
import { OutboxRepo } from '../outboxRepo';
import {
  ReplicaRepo, type ReplicaRecord, type ReseedCursor, type SyncEntity,
} from '../replicaRepo';
import { WalkRepo, type RoutePoint } from '../walkRepo';
import { fakeClock } from '../../testing/fakeClock';
import { memoryDriver, type MemoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';

const epoch = Date.UTC(2026, 9, 13, 12);
const entities: SyncEntity[] = [
  'members', 'family', 'pets', 'task_templates', 'weight_entries', 'health_events',
  'task_completions', 'task_timers', 'walk_sessions', 'assets',
];
const metadata = { pending: false, deleted: false, pullGen: 0 };
let driver: MemoryDriver;
let clock: ReturnType<typeof fakeClock>;
let ids: ReturnType<typeof sequentialIds>;
let factory: ReturnType<typeof rowFactories>;
let replica: ReplicaRepo;
let outbox: OutboxRepo;

beforeEach(async () => {
  clock = fakeClock(epoch);
  ids = sequentialIds();
  factory = rowFactories(clock, ids);
  driver = await memoryDriver();
  openDatabase(driver);
  replica = new ReplicaRepo(driver);
  outbox = new OutboxRepo(driver);
});
afterEach(() => driver.close());

function reseedAll(limit: number): ReplicaRecord[] {
  const result: ReplicaRecord[] = [];
  let after: ReseedCursor | null = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = replica.pageForReseed(after, limit);
    expect(page.length).toBeLessThanOrEqual(limit);
    result.push(...page);
    const last = page.at(-1);
    if (last === undefined) return result;
    after = { entity: last.entity, id: last.id };
  }
  throw new Error('Reseed pagination did not terminate');
}

describe('replica repository', () => {
  test.each(entities)('%s round-trips its JSON, metadata and specified range key', (entity) => {
    const row = factory[entity]();
    replica.upsert(entity, row, { pending: true, deleted: false, pullGen: 7 });
    const expectedSortKey = entity === 'task_completions' ? '2026-10-13T08:00'
      : ['weight_entries', 'health_events', 'walk_sessions'].includes(entity)
        ? '2026-10-13T12:00:00.000Z' : null;
    expect(replica.get(entity, row.id)).toEqual({
      entity, id: row.id, revision: 1, pending: true, deleted: false,
      pullGen: 7, sortKey: expectedSortKey, row,
    });
  });

  test('upsert replaces a row atomically and preserves a null local revision', () => {
    const pet = factory.pets();
    replica.upsert('pets', pet, metadata);
    const local = { ...pet, name: 'Updated Aurora', revision: null };
    replica.upsert('pets', local, { pending: true, deleted: false, pullGen: 8 });
    expect(replica.get('pets', pet.id)).toEqual({
      entity: 'pets', id: pet.id, revision: null, pending: true, deleted: false,
      pullGen: 8, sortKey: null, row: local,
    });
    expect(driver.all('SELECT id FROM replica')).toEqual([{ id: pet.id }]);
  });

  test('get returns null for an absent row and remove scopes the composite entity key', () => {
    const pet = factory.pets();
    const member = factory.members({ id: pet.id });
    expect(replica.get('pets', pet.id)).toBeNull();
    replica.upsert('pets', pet, metadata);
    replica.upsert('members', member, metadata);
    replica.remove('pets', pet.id);
    replica.remove('pets', pet.id);
    expect(replica.get('pets', pet.id)).toBeNull();
    expect(replica.get('members', pet.id)?.row).toEqual(member);
  });

  test('allExceptOldCompletions excludes only completions before the cutoff and tombstones', () => {
    const old = factory.task_completions({ occurrence_key: '2026-06-14T08:00' });
    const boundary = factory.task_completions({ occurrence_key: '2026-06-15' });
    const recent = factory.task_completions();
    const oldWeight = factory.weight_entries({ measured_at: '2020-01-01T00:00:00Z' });
    const pet = factory.pets();
    const deleted = factory.pets({ deleted_at: '2026-10-13T12:00:00Z' });
    for (const completion of [old, boundary, recent]) {
      replica.upsert('task_completions', completion, metadata);
    }
    replica.upsert('weight_entries', oldWeight, metadata);
    replica.upsert('pets', pet, metadata);
    replica.upsert('pets', deleted, { ...metadata, deleted: true });
    expect(replica.allExceptOldCompletions('2026-06-15').map((entry) => entry.id).sort())
      .toEqual([boundary.id, recent.id, oldWeight.id, pet.id].sort());
    expect(replica.get('task_completions', old.id)?.row).toEqual(old);
    expect(replica.get('pets', deleted.id)?.deleted).toBe(true);
  });

  test.each([
    ['weight_entries', 'measured_at'],
    ['health_events', 'occurred_at'],
    ['walk_sessions', 'started_at'],
    ['task_completions', 'occurrence_key'],
  ] as const)('range uses the %s sort key and excludes other entities and outside rows',
    (entity, field) => {
      const early = { ...factory[entity](), [field]: '2026-10-01T08:00' };
      const middle = { ...factory[entity](), [field]: '2026-10-13T08:00' };
      const late = { ...factory[entity](), [field]: '2026-10-31T08:00' };
      for (const row of [late, early, middle]) replica.upsert(entity, row, metadata);
      replica.upsert('pets', factory.pets(), metadata);
      expect(replica.range(entity, '2026-10-10', '2026-10-20').map((entry) => entry.id))
        .toEqual([middle.id]);
      expect(replica.range(entity, '2027-01-01', '2027-02-01')).toEqual([]);
    });

  test('a tombstone is hidden from range and hydration but included in pageForReseed', () => {
    const live = factory.weight_entries();
    const deleted = factory.weight_entries({ deleted_at: '2026-10-13T12:00:00Z' });
    replica.upsert('weight_entries', deleted, { ...metadata, deleted: true, pullGen: 9 });
    replica.upsert('weight_entries', live, metadata);
    expect(replica.range('weight_entries', '2026-10-01', '2026-10-31').map((entry) => entry.id))
      .toEqual([live.id]);
    expect(replica.allExceptOldCompletions('2026-01-01').map((entry) => entry.id))
      .toEqual([live.id]);
    expect(replica.pageForReseed(null, 500)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: deleted.id, deleted: true, pullGen: 9, row: deleted }),
      expect.objectContaining({ id: live.id, deleted: false }),
    ]));
  });

  test('undone completions and cancelled timers stay available for reseeding', () => {
    const completion = factory.task_completions({
      undone_at: '2026-10-13T12:00:00Z', undone_by: factory.memberId,
    });
    const timer = factory.task_timers({ cancelled_at: '2026-10-13T12:00:00Z' });
    replica.upsert('task_completions', completion, metadata);
    replica.upsert('task_timers', timer, metadata);
    expect(replica.allExceptOldCompletions('2026-01-01').map((entry) => entry.id).sort())
      .toEqual([completion.id, timer.id].sort());
    expect(reseedAll(1).map((entry) => entry.row)).toEqual([completion, timer]);
  });

  test('clearSynced keeps only rows protected by matching outbox entries regardless of pending', () => {
    const protectedPet = factory.pets();
    const synced = factory.pets();
    const unprotectedPending = factory.pets();
    const sameIdOtherEntity = factory.members({ id: protectedPet.id });
    replica.upsert('pets', protectedPet, metadata);
    replica.upsert('pets', synced, metadata);
    replica.upsert('pets', unprotectedPending, { ...metadata, pending: true });
    replica.upsert('members', sameIdOtherEntity, metadata);
    outbox.insert(factory.outbox({ entityId: protectedPet.id }));
    replica.clearSynced();
    expect(driver.all('SELECT entity, id FROM replica')).toEqual([
      { entity: 'pets', id: protectedPet.id },
    ]);
    expect(outbox.count()).toBe(1);
  });

  test('sweepUnmarked keeps this pull and matching outbox rows including protected tombstones', () => {
    const marked = factory.pets();
    const protectedPet = factory.pets();
    const protectedDeleted = factory.weight_entries({ deleted_at: '2026-10-13T12:00:00Z' });
    const unmarked = factory.pets();
    const unprotectedPending = factory.pets();
    replica.upsert('pets', marked, { ...metadata, pullGen: 4 });
    replica.upsert('pets', protectedPet, { ...metadata, pullGen: 3 });
    replica.upsert('weight_entries', protectedDeleted, { ...metadata, deleted: true, pullGen: 2 });
    replica.upsert('pets', unmarked, { ...metadata, pullGen: 3 });
    replica.upsert('pets', unprotectedPending, { ...metadata, pending: true });
    replica.upsert('members', factory.members({ id: protectedPet.id }), metadata);
    outbox.insert(factory.outbox({ entityId: protectedPet.id }));
    outbox.insert(factory.outbox({ entity: 'weight_entries', entityId: protectedDeleted.id }));
    replica.sweepUnmarked(4);
    expect(driver.all<{ id: string }>('SELECT id FROM replica').map((row) => row.id).sort())
      .toEqual([marked.id, protectedPet.id, protectedDeleted.id].sort());
    expect(outbox.count()).toBe(2);
  });

  test.each([1, 2, 7, 500])(
    'pageForReseed visits each eligible row once in entity order with page size %i',
    (limit) => {
      const expected: { entity: SyncEntity; id: string }[] = [];
      // Insert backwards so neither insertion order nor lexical entity order can pass.
      for (const entity of [...entities].reverse()) {
        const rows = [factory[entity](), factory[entity](), factory[entity]()];
        for (const row of [...rows].reverse()) {
          replica.upsert(entity, row, { ...metadata, pending: true });
        }
        if (entity !== 'assets') {
          expected.unshift(...rows.map((row) => ({ entity, id: row.id })));
        }
      }
      const protectedPet = factory.pets();
      replica.upsert('pets', protectedPet, metadata);
      outbox.insert(factory.outbox({ entityId: protectedPet.id }));
      const old = factory.task_completions({ occurrence_key: '2020-01-01' });
      replica.upsert('task_completions', old, metadata);
      const completionIndex = expected.findLastIndex((entry) => entry.entity === 'task_completions');
      expected.splice(completionIndex + 1, 0, { entity: 'task_completions', id: old.id });
      const result = reseedAll(limit).map(({ entity, id }) => ({ entity, id }));
      expect(result).toEqual(expected);
      expect(new Set(result.map((entry) => `${entry.entity}:${entry.id}`)).size).toBe(expected.length);
    },
  );

  test('pageForReseed puts replaced templates and original completions before their dependents', () => {
    const successor = factory.task_templates();
    const middle = factory.task_templates();
    const root = factory.task_templates();
    middle.replaces_task_id = root.id;
    successor.replaces_task_id = middle.id;
    for (const row of [successor, middle, root]) replica.upsert('task_templates', row, metadata);
    const duplicate = factory.task_completions();
    const winner = factory.task_completions();
    duplicate.duplicate_of = winner.id;
    replica.upsert('task_completions', duplicate, metadata);
    replica.upsert('task_completions', winner, metadata);
    expect(reseedAll(1).map((entry) => entry.id))
      .toEqual([root.id, middle.id, successor.id, winner.id, duplicate.id]);
  });

  test('pageForReseed distinguishes identical ids in different entities and returns an empty final page', () => {
    const member = factory.members();
    const family = factory.family({ id: member.id });
    replica.upsert('members', member, metadata);
    replica.upsert('family', family, metadata);
    expect(reseedAll(1).map((entry) => entry.entity)).toEqual(['members', 'family']);
    expect(replica.pageForReseed({ entity: 'family', id: family.id }, 1)).toEqual([]);
  });

  test('pageForReseed excludes assets because reseed accepts their files through upload only', () => {
    replica.upsert('assets', factory.assets(), metadata);
    expect(replica.pageForReseed(null, 500)).toEqual([]);
  });
});

describe('outbox repository', () => {
  test('a queued DELETE retains a SQL NULL body after reopening', async () => {
    const entry = outbox.insert(factory.outbox({ method: 'DELETE', body: null }));
    expect(driver.all('SELECT body FROM outbox WHERE seq = ?', [entry.seq]))
      .toEqual([{ body: null }]);
    const reopened = await memoryDriver(driver.export());
    try {
      expect(new OutboxRepo(reopened).head(entry.userId)).toEqual(entry);
    } finally {
      reopened.close();
    }
  });

  test('insert round-trips JSON with defaults and monotonically increasing seq after deletion', () => {
    const input = factory.outbox();
    const first = outbox.insert(input);
    expect(first).toEqual({
      ...input, seq: 1, attempts: 0, serverErrors: 0, nextRetryAt: 0, lastError: null,
    });
    expect(outbox.head(input.userId)).toEqual(first);
    outbox.remove(first.seq);
    const second = outbox.insert(factory.outbox({ method: 'DELETE', body: null }));
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(second.body).toBeNull();
    expect(outbox.count()).toBe(1);
  });

  test('head respects seq and user_id even when created_at has the opposite order', () => {
    const otherUser = ids.uuid();
    outbox.insert(factory.outbox({ userId: otherUser }));
    const first = outbox.insert(factory.outbox());
    clock.advance(-1_000);
    const second = outbox.insert(factory.outbox());
    expect(outbox.head(factory.memberId)).toEqual(first);
    expect(outbox.head(otherUser)?.userId).toBe(otherUser);
    expect(outbox.head('absent')).toBeNull();
    outbox.remove(first.seq);
    expect(outbox.head(factory.memberId)).toEqual(second);
  });

  test('retry updates preserve the body and independently store server_errors', () => {
    const first = outbox.insert(factory.outbox());
    const retry = { attempts: 3, serverErrors: 1, nextRetryAt: epoch + 10_000, lastError: 'offline' };
    outbox.update(first.seq, retry);
    expect(outbox.head(first.userId)).toEqual({ ...first, ...retry });
    outbox.update(first.seq, { ...retry, attempts: 4, lastError: null });
    expect(outbox.head(first.userId)?.lastError).toBeNull();
  });

  test('hasEntryFor matches both entity and id and removeForEntityId removes every queued action', () => {
    const petId = ids.uuid();
    const otherId = ids.uuid();
    const first = outbox.insert(factory.outbox({ entityId: petId }));
    outbox.insert(factory.outbox({ entityId: petId, method: 'PATCH' }));
    outbox.insert(factory.outbox({ entityId: otherId }));
    expect(outbox.hasEntryFor('pets', petId)).toBe(true);
    expect(outbox.hasEntryFor('members', petId)).toBe(false);
    expect(outbox.hasEntryFor('pets', 'missing')).toBe(false);
    outbox.removeForEntityId(petId);
    outbox.remove(first.seq);
    expect(outbox.hasEntryFor('pets', petId)).toBe(false);
    expect(outbox.count()).toBe(1);
    expect(outbox.head(factory.memberId)?.entityId).toBe(otherId);
  });

  test('client_mutation_id is unique on disk', () => {
    const input = factory.outbox();
    outbox.insert(input);
    expect(() => outbox.insert(input)).toThrow();
    expect(outbox.count()).toBe(1);
  });

  test('an outer transaction rolls back replica and outbox writes together', () => {
    const pet = factory.pets();
    const failure = new Error('injected local write failure');
    expect(() => driver.transaction(() => {
      replica.upsert('pets', pet, { ...metadata, pending: true });
      outbox.insert(factory.outbox({ entityId: pet.id }));
      throw failure;
    })).toThrow(failure);
    expect(replica.get('pets', pet.id)).toBeNull();
    expect(outbox.count()).toBe(0);
  });

  test('outbox entries and replica rows survive reopening the exported database', async () => {
    const pet = factory.pets();
    replica.upsert('pets', pet, { ...metadata, pending: true });
    const queued = outbox.insert(factory.outbox({ entityId: pet.id }));
    const reopened = await memoryDriver(driver.export());
    try {
      openDatabase(reopened);
      expect(new OutboxRepo(reopened).head(factory.memberId)).toEqual(queued);
      expect(new ReplicaRepo(reopened).get('pets', pet.id)?.row).toEqual(pet);
    } finally {
      reopened.close();
    }
  });
});

describe('dead-letter repository', () => {
  test('upsert round-trips JSON and repeated rejection leaves exactly one updated entry', () => {
    const repo = new DeadLetterRepo(driver);
    const entry = factory.deadLetter();
    repo.upsert(entry);
    repo.upsert(entry);
    expect(repo.count()).toBe(1);
    expect(repo.list()).toEqual([entry]);
    clock.advance(1_000);
    const replacement = { ...entry, body: null, error: 'refused', failedAt: clock.now() };
    repo.upsert(replacement);
    expect(repo.list()).toEqual([replacement]);
    expect(repo.count()).toBe(1);
  });

  test('an empty dead-letter list has zero count', () => {
    const repo = new DeadLetterRepo(driver);
    expect(repo.list()).toEqual([]);
    expect(repo.count()).toBe(0);
  });
});

describe('key-value repository', () => {
  test('strings round-trip, overwrite and remove without parsing JSON or dropping empty values', () => {
    const kv = new Kv(driver);
    expect(kv.get('missing')).toBeNull();
    kv.set('session_user', '{"id":"member"}');
    expect(kv.get('session_user')).toBe('{"id":"member"}');
    kv.set('session_user', '');
    expect(kv.get('session_user')).toBe('');
    kv.remove('session_user');
    kv.remove('session_user');
    expect(kv.get('session_user')).toBeNull();
  });

  test.each<ServerKeyName>([
    'last_revision', 'sync_epoch', 'reseeded_epoch', 'signed_out', 'push_token_sent',
  ])('RS-9: %s is isolated between primary and reserve', (name) => {
    const kv = new Kv(driver);
    const primary = serverKey(name, 'primary');
    const reserve = serverKey(name, 'reserve');
    expect(primary).toBe(`${name}.primary`);
    expect(reserve).toBe(`${name}.reserve`);
    kv.set(primary, 'primary-value');
    kv.set(reserve, 'reserve-value');
    expect(kv.get(primary)).toBe('primary-value');
    expect(kv.get(reserve)).toBe('reserve-value');
    kv.remove(primary);
    expect(kv.get(reserve)).toBe('reserve-value');
  });
});

describe('asset-file repository', () => {
  test.each(['to_upload', 'uploaded', 'downloaded', 'failed'] as const)(
    '%s asset files round-trip nullable fields and retry metadata',
    (state) => {
      const repo = new AssetRepo(driver);
      const file = factory.assetFile({
        state, localUri: state === 'failed' ? null : 'file:///assets/proof.jpg',
        sha256: state === 'downloaded' ? null : 'a'.repeat(64),
        attempts: 2, nextRetryAt: epoch + 1_000,
      });
      repo.upsert(file);
      expect(repo.get(file.id)).toEqual(file);
      expect(repo.list()).toEqual([file]);
      const updated = { ...file, attempts: 3 };
      repo.upsert(updated);
      expect(repo.list()).toEqual([updated]);
      repo.remove(file.id);
      repo.remove(file.id);
      expect(repo.get(file.id)).toBeNull();
      expect(repo.list()).toEqual([]);
    },
  );
});

describe('walk repository', () => {
  test('active and paused local walks round-trip both tracking modes and nullable pause time', () => {
    const repo = new WalkRepo(driver);
    expect(repo.getLocal()).toBeNull();
    const walk = factory.localWalk();
    repo.upsertLocal(walk);
    expect(repo.getLocal()).toEqual(walk);
    clock.advance(1_000);
    const paused = { ...walk, state: 'paused' as const,
      pauseStartedAt: clock.now(), pausedMs: 50, trackingMode: 'foreground' as const };
    repo.upsertLocal(paused);
    expect(repo.getLocal()).toEqual(paused);
    repo.removeLocal('missing');
    expect(repo.getLocal()).toEqual(paused);
    repo.removeLocal(walk.id);
    expect(repo.getLocal()).toBeNull();
  });

  test('walk points round-trip in seq order and keep paused or inaccurate fixes', () => {
    const repo = new WalkRepo(driver);
    const walkId = ids.uuid();
    const otherId = ids.uuid();
    const first = factory.walkPoint({ walkId, seq: 0 });
    const last = factory.walkPoint({ walkId, seq: 1, t: epoch + 3_000, acc: 80, paused: true });
    const other = factory.walkPoint({ walkId: otherId, seq: 0 });
    repo.insertPoint(last);
    repo.insertPoint(first);
    repo.insertPoint(other);
    expect(repo.points(walkId)).toEqual([first, last]);
    repo.removePoints(walkId);
    expect(repo.points(walkId)).toEqual([]);
    expect(repo.points(otherId)).toEqual([other]);
  });

  test('cached routes round-trip all coordinate tuple fields and survive reopening', async () => {
    const repo = new WalkRepo(driver);
    const walkId = ids.uuid();
    const points: RoutePoint[] = [
      [-23.55, -46.63, epoch, 8], [-23.551, -46.631, epoch + 3_000, 9],
    ];
    expect(repo.getRoute(walkId)).toBeNull();
    repo.upsertRoute({ walkId, points });
    expect(repo.getRoute(walkId)).toEqual(points);
    expect(repo.listRoutes()).toEqual([{ walkId, points }]);
    const reopened = await memoryDriver(driver.export());
    try {
      expect(new WalkRepo(reopened).getRoute(walkId)).toEqual(points);
    } finally {
      reopened.close();
    }
    repo.upsertRoute({ walkId, points: [] });
    expect(repo.getRoute(walkId)).toEqual([]);
    repo.removeRoute(walkId);
    repo.removeRoute(walkId);
    expect(repo.getRoute(walkId)).toBeNull();
    expect(repo.listRoutes()).toEqual([]);
  });
});
