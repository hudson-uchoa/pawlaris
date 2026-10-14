import type { Completion } from '@pawlaris/shared';
import type { OutboxEntry } from '../../db/outboxRepo';
import type { HttpResponse } from '../../platform/http';
import { fakeRandom } from '../../testing/fakeRandom';
import { backoff } from '../backoff';
import { createSyncEvents } from '../events';
import { failure, petMutation, queued, seedMutation, syncContext, type SyncContext } from './support';

let c: SyncContext;
beforeEach(async () => { c = await syncContext(undefined, Array.from({ length: 40 }, () => 0.5)); });
afterEach(() => { c.driver.close(); });

function requiredHead(): OutboxEntry {
  const head = c.outbox.head(c.sessionUser.id);
  if (head === null) throw new Error('Test expected an outbox head');
  return head;
}

function queuePets(count: number) {
  const mutations = Array.from({ length: count }, (_, index) => petMutation(c, `Pet ${index + 1}`));
  for (const mutation of mutations) seedMutation(c, mutation);
  return mutations;
}

function answerPets() {
  for (const entry of queued(c)) {
    const record = c.replica.get('pets', entry.entityId);
    if (record === null) throw new Error('Test expected a queued pet');
    c.http.enqueue({ status: 200, body: { ...record.row, revision: entry.seq }, headers: {} });
  }
}

test('OB-1: 20 queued mutations survive exported-database restart and drain once in seq order', async () => {
  const mutations = queuePets(20);
  const exported = c.driver.export();
  c.driver.close();
  c = await syncContext(exported);
  expect(c.outbox.count()).toBe(20);
  answerPets();
  expect(await c.drain.drain()).toBe('empty');
  expect(c.http.requests).toHaveLength(20);
  expect(c.http.requests.map((request) => request.body)).toEqual(mutations.map((mutation) => mutation.body));
  expect(c.http.requests.map((request) => request.headers?.['Idempotency-Key']))
    .toEqual(mutations.map((mutation) => mutation.clientMutationId));
  expect(c.http.requests.every((request) => request.method === 'POST' && request.url.endsWith('/pets'))).toBe(true);
  expect(c.outbox.count()).toBe(0);
  expect(await c.drain.drain()).toBe('empty');
  expect(c.http.requests).toHaveLength(20);
  for (const mutation of mutations) {
    expect(c.replica.get('pets', mutation.entityId)?.pending).toBe(false);
    expect(c.store.getState().pending[`pets:${mutation.entityId}`]).toBeUndefined();
  }
});

test.each(['primary', 'reserve'] as const)(
  'OB-2: entry 3 rejection survives a crash after commit and resets only %s cursor', async (server) => {
    c.kv.set('active_server', server);
    await c.session.adopt({
      access_token: 'fake-test-access', refresh_token: 'fake-test-refresh',
      access_expires_at: new Date(c.clock.now() + 900_000).toISOString(), user: c.sessionUser,
    }, server);
    c.kv.set('last_revision.primary', '91');
    c.kv.set('last_revision.reserve', '73');
    const mutations = queuePets(5);
    const rejected = mutations[2];
    if (rejected === undefined) throw new Error('Test expected the third mutation');
    mutations.forEach((mutation, index) => {
      c.http.enqueue({ status: index === 2 ? 422 : 200, body: mutation.localRow, headers: {} });
    });
    let snapshot: Uint8Array | undefined;
    c.driver.onTransactionEnd((committed) => {
      if (committed && c.deadLetter.count() === 1 && snapshot === undefined) {
        snapshot = c.driver.export();
        throw new Error('simulated process death after rejection commit');
      }
    });
    await expect(c.drain.drain()).rejects.toThrow('simulated process death after rejection commit');
    expect(c.http.requests).toHaveLength(3);
    if (snapshot === undefined) throw new Error('Test expected a committed crash snapshot');
    c.driver.close();
    c = await syncContext(snapshot);
    expect(c.deadLetter.list()).toEqual([expect.objectContaining({
      clientMutationId: rejected.clientMutationId, status: 422, method: 'POST',
      path: '/pets', body: rejected.body,
    })]);
    expect(c.replica.get('pets', rejected.entityId)).toBeNull();
    expect(c.store.getState().pets[rejected.entityId]).toBeUndefined();
    expect(c.kv.get(`last_revision.${server}`)).toBe('0');
    expect(c.kv.get(`last_revision.${server === 'primary' ? 'reserve' : 'primary'}`))
      .toBe(server === 'primary' ? '73' : '91');
    expect(queued(c).map((entry) => entry.entityId)).toEqual(mutations.slice(3).map((mutation) => mutation.entityId));
    answerPets();
    expect(await c.drain.drain()).toBe('empty');
    expect(c.http.requests.map((request) => request.body)).toEqual(mutations.slice(3).map((mutation) => mutation.body));
    expect(c.deadLetter.count()).toBe(1);
    expect(c.outbox.count()).toBe(0);
  },
);

test('OB-3: a transient on entry 2 blocks all later entries until fake backoff expires', async () => {
  const mutations = queuePets(4);
  c.http.enqueue(
    { status: 200, body: mutations[0]?.localRow, headers: {} },
    new Error('simulated network failure'),
    ...mutations.slice(1).map((mutation): HttpResponse => ({ status: 200, body: mutation.localRow, headers: {} })),
  );
  const initial = c.clock.now();
  expect(await c.drain.drain()).toBe('waiting');
  expect(c.http.requests).toHaveLength(2);
  expect(requiredHead()).toMatchObject({
    entityId: mutations[1]?.entityId, attempts: 1, serverErrors: 0,
    nextRetryAt: initial + 1_500,
  });
  expect(requiredHead().lastError).toEqual(expect.any(String));
  c.clock.advance(1_499);
  expect(await c.drain.drain()).toBe('waiting');
  expect(c.http.requests).toHaveLength(2);
  c.clock.advance(1);
  expect(await c.drain.drain()).toBe('empty');
  expect(c.http.requests.map((request) => request.headers?.['Idempotency-Key']))
    .toEqual([mutations[0]?.clientMutationId, mutations[1]?.clientMutationId,
      ...mutations.slice(1).map((mutation) => mutation.clientMutationId)]);
  expect(c.deadLetter.count()).toBe(0);
});

test('OB-4: lost completion removes the loser and queued undo, stores winner and emits once', async () => {
  const loser = c.factory.task_completions({ revision: null });
  const winner: Completion = c.factory.task_completions({
    task_id: loser.task_id, occurrence_key: loser.occurrence_key, completed_by: c.ids.uuid(), revision: 67,
  });
  seedMutation(c, {
    clientMutationId: c.ids.uuid(), method: 'POST', path: '/completions', body: { id: loser.id },
    entity: 'task_completions', entityId: loser.id, localRow: loser,
  });
  seedMutation(c, {
    clientMutationId: c.ids.uuid(), method: 'POST', path: `/completions/${loser.id}/undo`, body: null,
    entity: 'task_completions', entityId: loser.id,
    localRow: { ...loser, undone_at: new Date(c.clock.now()).toISOString(), undone_by: c.sessionUser.id },
  });
  const listener = jest.fn(() => {
    expect(c.outbox.count()).toBe(0);
    expect(c.replica.get('task_completions', loser.id)).toBeNull();
    expect(c.store.getState().completions[winner.id]).toEqual(winner);
  });
  c.events.on('completion_lost', listener);
  c.http.enqueue({ status: 200, body: winner, headers: {} });
  expect(await c.drain.drain()).toBe('empty');
  expect(c.http.requests).toHaveLength(1);
  expect(c.replica.get('task_completions', loser.id)).toBeNull();
  expect(c.store.getState().completions[loser.id]).toBeUndefined();
  expect(c.replica.get('task_completions', winner.id)).toMatchObject({ row: winner, pending: false });
  expect(c.store.getState().pending[`task_completions:${winner.id}`]).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ winner });
  expect(await c.drain.drain()).toBe('empty');
  expect(listener).toHaveBeenCalledTimes(1);
});

test('OB-5: the eighth HTTP 500 rejects, network failures never count, later entries drain', async () => {
  const mutations = queuePets(2);
  for (let response = 1; response <= 8; response += 1) {
    c.http.enqueue(new Error('network interrupted'));
    expect(await c.drain.drain()).toBe('waiting');
    expect(requiredHead().serverErrors).toBe(response - 1);
    expect(requiredHead().attempts).toBe(2 * response - 1);
    c.clock.advance(requiredHead().nextRetryAt - c.clock.now());
    c.http.enqueue({ status: 500, body: { code: 'internal_error' }, headers: {} });
    if (response < 8) {
      expect(await c.drain.drain()).toBe('waiting');
      expect(requiredHead().serverErrors).toBe(response);
      expect(c.deadLetter.count()).toBe(0);
      expect(c.outbox.count()).toBe(2);
      c.clock.advance(requiredHead().nextRetryAt - c.clock.now());
    } else {
      c.http.enqueue({ status: 200, body: mutations[1]?.localRow, headers: {} });
      expect(await c.drain.drain()).toBe('empty');
    }
  }
  expect(c.http.requests).toHaveLength(17);
  expect(c.http.requests.slice(0, 16).every((request) =>
    request.headers?.['Idempotency-Key'] === mutations[0]?.clientMutationId)).toBe(true);
  expect(c.http.requests[16]?.headers?.['Idempotency-Key']).toBe(mutations[1]?.clientMutationId);
  expect(c.deadLetter.list()).toEqual([expect.objectContaining({ status: 500, clientMutationId: mutations[0]?.clientMutationId })]);
  expect(c.replica.get('pets', mutations[0]?.entityId ?? '')).toBeNull();
  expect(c.outbox.count()).toBe(0);
});

test('OB-6: rejecting the same entry twice is harmless and leaves one dead letter', () => {
  queuePets(1);
  const entry = requiredHead();
  c.drain.reject(entry, failure(422));
  expect(() => c.drain.reject(entry, failure(422))).not.toThrow();
  expect(c.deadLetter.count()).toBe(1);
  expect(c.deadLetter.list()[0]).toMatchObject({
    clientMutationId: entry.clientMutationId, status: 422, body: entry.body,
    createdAt: entry.createdAt, failedAt: c.clock.now(),
  });
  expect(c.outbox.count()).toBe(0);
  expect(c.replica.get(entry.entity, entry.entityId)).toBeNull();
  expect(c.kv.get('last_revision.primary')).toBe('0');
});

test('OB-2: reject emits after the outer commit and never after its rollback', () => {
  queuePets(1);
  const entry = requiredHead();
  const before = c.store.getState();
  c.kv.set('last_revision.primary', '79');
  const listener = jest.fn(() => {
    expect(c.deadLetter.count()).toBe(1);
    expect(c.outbox.count()).toBe(0);
    expect(c.kv.get('last_revision.primary')).toBe('0');
    expect(c.store.getState().pets[entry.entityId]).toBeUndefined();
  });
  c.events.on('mutation_rejected', listener);
  expect(() => c.driver.transaction(() => {
    c.drain.reject(entry, failure(422));
    expect(listener).not.toHaveBeenCalled();
    expect(c.store.getState()).toBe(before);
    throw new Error('reject rollback');
  })).toThrow('reject rollback');
  expect(c.deadLetter.count()).toBe(0);
  expect(c.outbox.count()).toBe(1);
  expect(c.kv.get('last_revision.primary')).toBe('79');
  expect(c.store.getState()).toBe(before);
  c.driver.transaction(() => {});
  expect(listener).not.toHaveBeenCalled();
  c.driver.transaction(() => {
    c.drain.reject(entry, failure(422));
    expect(listener).not.toHaveBeenCalled();
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ entry });
});

test('OB-2: a failure resetting the cursor rolls back dead letter, row removal and outbox deletion', () => {
  queuePets(1);
  const entry = requiredHead();
  const before = c.store.getState();
  c.kv.set('last_revision.primary', '83');
  c.driver.run(`CREATE TRIGGER reject_cursor BEFORE INSERT ON kv
    WHEN NEW.key = 'last_revision.primary' BEGIN SELECT RAISE(ABORT, 'cursor write failed'); END`);
  expect(() => c.drain.reject(entry, failure(422))).toThrow('cursor write failed');
  expect(c.deadLetter.count()).toBe(0);
  expect(c.outbox.count()).toBe(1);
  expect(c.replica.get(entry.entity, entry.entityId)).not.toBeNull();
  expect(c.kv.get('last_revision.primary')).toBe('83');
  expect(c.store.getState()).toBe(before);
});

test('OB-2: reject keeps newer local intent targeting the same row', () => {
  const mutation = petMutation(c, 'Original');
  seedMutation(c, mutation);
  const first = requiredHead();
  if (mutation.localRow === null || mutation.entity !== 'pets') throw new Error('Test expected pet mutation');
  const later = { ...mutation.localRow, name: 'Newer intent' };
  seedMutation(c, {
    ...mutation, clientMutationId: c.ids.uuid(), method: 'PATCH',
    path: `/pets/${mutation.entityId}`, body: { name: later.name }, localRow: later,
  });
  c.drain.reject(first, failure(422));
  expect(c.replica.get('pets', first.entityId)?.row).toEqual(later);
  expect(c.store.getState().pets[first.entityId]).toEqual(later);
  expect(c.outbox.count()).toBe(1);
  expect(c.deadLetter.count()).toBe(1);
});

test('OB-1: only the session user entries drain, ordered by their seq', async () => {
  c.outbox.insert(c.factory.outbox({ userId: c.ids.uuid() }));
  queuePets(2);
  const entries = queued(c).slice(1);
  for (const entry of entries) c.http.enqueue({
    status: 200, body: c.replica.get('pets', entry.entityId)?.row, headers: {},
  });
  expect(await c.drain.drain()).toBe('empty');
  expect(c.http.requests.map((request) => request.body)).toEqual(entries.map((entry) => entry.body));
  expect(c.outbox.count()).toBe(1);
  expect(c.outbox.head(c.sessionUser.id)).toBeNull();
});

test('OB-1: an earlier ack leaves a newer queued edit pending until its own ack', async () => {
  const mutation = petMutation(c, 'First value');
  const first = seedMutation(c, mutation);
  if (mutation.entity !== 'pets' || mutation.localRow === null) throw new Error('Test expected pet mutation');
  const later = { ...mutation.localRow, name: 'Latest local value' };
  seedMutation(c, {
    ...mutation, clientMutationId: c.ids.uuid(), method: 'PATCH',
    path: `/pets/${mutation.entityId}`, body: { name: later.name }, localRow: later,
  });
  const acknowledged = { ...mutation.localRow, revision: 89 };
  c.driver.transaction(() => {
    c.drain.onAck(first, acknowledged);
    c.outbox.remove(first.seq);
  });
  expect(c.replica.get('pets', first.entityId)).toMatchObject({ row: later, pending: true });
  expect(c.store.getState().pets[first.entityId]).toEqual(later);
  c.http.enqueue({ status: 200, body: { ...later, revision: 90 }, headers: {} });
  expect(await c.drain.drain()).toBe('empty');
  expect(c.replica.get('pets', first.entityId)).toMatchObject({ row: { ...later, revision: 90 }, pending: false });
  expect(c.store.getState().pending[`pets:${first.entityId}`]).toBeUndefined();
});

test('OB-1: a delete ack writes a tombstone while the store stays empty', async () => {
  const row = c.factory.weight_entries();
  seedMutation(c, {
    clientMutationId: c.ids.uuid(), method: 'DELETE', path: `/weights/${row.id}`, body: null,
    entity: 'weight_entries', entityId: row.id, localRow: null,
  });
  const tombstone = { ...row, deleted_at: new Date(c.clock.now()).toISOString(), revision: 97 };
  c.http.enqueue({ status: 200, body: tombstone, headers: {} });
  expect(await c.drain.drain()).toBe('empty');
  expect(c.replica.get('weight_entries', row.id)).toMatchObject({ row: tombstone, deleted: true, pending: false });
  expect(c.store.getState().weightEntries[row.id]).toBeUndefined();
});

test('OB-1: onAck replaces its own pending row after the outer commit', () => {
  const mutation = petMutation(c, 'Optimistic value');
  const entry = seedMutation(c, mutation);
  if (mutation.entity !== 'pets' || mutation.localRow === null) throw new Error('Test expected pet mutation');
  const serverRow = { ...mutation.localRow, name: 'Server value', revision: 99 };
  const before = c.store.getState();
  c.driver.transaction(() => {
    c.drain.onAck(entry, serverRow);
    c.outbox.remove(entry.seq);
    expect(c.store.getState()).toBe(before);
  });
  expect(c.replica.get('pets', entry.entityId)).toMatchObject({ row: serverRow, pending: false });
  expect(c.store.getState().pets[entry.entityId]).toEqual(serverRow);
  expect(c.store.getState().pending[`pets:${entry.entityId}`]).toBeUndefined();
});

test('OB-1: an ack and outbox deletion roll back together when deletion fails', async () => {
  const mutation = petMutation(c, 'Local');
  seedMutation(c, mutation);
  const before = c.store.getState();
  c.driver.run(`CREATE TRIGGER reject_ack_delete BEFORE DELETE ON outbox
    BEGIN SELECT RAISE(ABORT, 'ack delete failed'); END`);
  c.http.enqueue({ status: 200, body: { ...mutation.localRow, revision: 101 }, headers: {} });
  await expect(c.drain.drain()).rejects.toThrow('ack delete failed');
  expect(c.outbox.count()).toBe(1);
  expect(c.replica.get('pets', mutation.entityId)).toMatchObject({ row: mutation.localRow, pending: true });
  expect(c.store.getState()).toBe(before);
});

test('OB-4: a lost-race ack rolls back all rows and queued undo without emitting', () => {
  const loser = c.factory.task_completions({ revision: null });
  const winner = c.factory.task_completions({ revision: 103 });
  seedMutation(c, {
    clientMutationId: c.ids.uuid(), method: 'POST', path: '/completions', body: { id: loser.id },
    entity: 'task_completions', entityId: loser.id, localRow: loser,
  });
  const first = requiredHead();
  seedMutation(c, {
    clientMutationId: c.ids.uuid(), method: 'POST', path: `/completions/${loser.id}/undo`, body: null,
    entity: 'task_completions', entityId: loser.id, localRow: loser,
  });
  const before = c.store.getState();
  const listener = jest.fn();
  c.events.on('completion_lost', listener);
  expect(() => c.driver.transaction(() => {
    c.drain.onAck(first, winner);
    expect(listener).not.toHaveBeenCalled();
    throw new Error('lost-race rollback');
  })).toThrow('lost-race rollback');
  expect(c.outbox.count()).toBe(2);
  expect(c.replica.get('task_completions', loser.id)?.row).toEqual(loser);
  expect(c.replica.get('task_completions', winner.id)).toBeNull();
  expect(c.store.getState()).toBe(before);
  c.driver.transaction(() => {});
  expect(listener).not.toHaveBeenCalled();
});

test('OB-3: auth stops draining and leaves optimistic state and retry counters untouched', async () => {
  queuePets(2);
  const before = c.store.getState();
  c.http.enqueue(
    { status: 401, body: null, headers: {} },
    { status: 401, body: null, headers: {} },
  );
  expect(await c.drain.drain()).toBe('signed_out');
  expect(c.outbox.count()).toBe(2);
  expect(requiredHead()).toMatchObject({ attempts: 0, serverErrors: 0, nextRetryAt: 0 });
  expect(c.store.getState()).toBe(before);
  expect(c.deadLetter.count()).toBe(0);
});

test.each([408, 425, 429, 503])('OB-3: HTTP %s waits without allowing overtaking', async (status) => {
  queuePets(2);
  c.http.enqueue({ status, body: null, headers: { 'Retry-After': '7' } });
  const initial = c.clock.now();
  expect(await c.drain.drain()).toBe('waiting');
  expect(c.http.requests).toHaveLength(1);
  expect(requiredHead()).toMatchObject({
    attempts: 1, serverErrors: status === 503 ? 1 : 0,
    nextRetryAt: initial + (status === 429 || status === 503 ? 7_000 : 1_500),
  });
});

test('OB-3: Retry-After HTTP date uses the injected clock', async () => {
  queuePets(1);
  c.http.enqueue({ status: 429, body: null, headers: {
    'retry-after': new Date(c.clock.now() + 9_000).toUTCString(),
  } });
  expect(await c.drain.drain()).toBe('waiting');
  expect(requiredHead().nextRetryAt).toBe(c.clock.now() + 9_000);
});

test.each([400, 403, 404, 409, 410, 413, 422, 302, 199])(
  'OB-2: permanent HTTP %s dead letters and continues draining', async (status) => {
    const mutations = queuePets(2);
    c.http.enqueue(
      { status, body: { code: 'request_refused' }, headers: {} },
      { status: 200, body: mutations[1]?.localRow, headers: {} },
    );
    expect(await c.drain.drain()).toBe('empty');
    expect(c.deadLetter.list()).toEqual([expect.objectContaining({ status })]);
    expect(c.outbox.count()).toBe(0);
    expect(c.http.requests).toHaveLength(2);
  },
);

test('OB-3: backoff uses injected jitter, caps at 60 seconds and honours retryAfter', () => {
  expect(backoff(1, null, fakeRandom(0))).toBe(1_000);
  expect(backoff(2, null, fakeRandom(0.5))).toBe(3_000);
  expect(backoff(20, null, fakeRandom(0.5))).toBe(45_000);
  expect(backoff(2, 7_000, fakeRandom())).toBe(7_000);
  expect(backoff(2, 0, fakeRandom())).toBe(0);
});

test('OB-4 and OB-2: typed events deliver only their payload and unsubscribe', () => {
  const events = createSyncEvents();
  const completion = jest.fn();
  const rejected = jest.fn();
  const unsubscribe = events.on('completion_lost', completion);
  events.on('mutation_rejected', rejected);
  const winner = c.factory.task_completions();
  events.emit('completion_lost', { winner });
  expect(completion).toHaveBeenCalledWith({ winner });
  expect(rejected).not.toHaveBeenCalled();
  unsubscribe();
  unsubscribe();
  events.emit('completion_lost', { winner });
  expect(completion).toHaveBeenCalledTimes(1);
  queuePets(1);
  const entry = requiredHead();
  events.emit('mutation_rejected', { entry });
  expect(rejected).toHaveBeenCalledWith({ entry });
});
