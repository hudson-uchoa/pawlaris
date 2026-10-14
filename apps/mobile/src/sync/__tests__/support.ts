import { createApi, type ApiResult } from '../../api/client';
import { createSession } from '../../auth/session';
import { wireSession, servers, epoch } from '../../auth/__tests__/support';
import { DeadLetterRepo } from '../../db/deadLetterRepo';
import { Kv, type Server } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { OutboxRepo } from '../../db/outboxRepo';
import { ReplicaRepo } from '../../db/replicaRepo';
import { createReplicaApply, hydrateReplica } from '../../replica/apply';
import { createReplicaStore } from '../../replica/store';
import { fakeClock } from '../../testing/fakeClock';
import { fakeHttp } from '../../testing/fakeHttp';
import { fakeRandom } from '../../testing/fakeRandom';
import { fakeSecretBox } from '../../testing/fakeSecretBox';
import { memoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { createSyncEvents } from '../events';
import { createMutations, type Mutation } from '../mutations';
import { createOutbox } from '../outbox';
import { createServerSelect } from '../serverSelect';

export async function syncContext(data?: Uint8Array, randomValues: number[] = []) {
  const driver = await memoryDriver(data);
  openDatabase(driver);
  const clock = fakeClock(epoch);
  const ids = sequentialIds();
  const factory = rowFactories(clock, ids);
  const sessionUser = wireSession('primary').user;
  const kv = new Kv(driver);
  const http = fakeHttp();
  const secretBox = fakeSecretBox();
  const serverSelect = createServerSelect({ http, clock, kv, servers });
  const activeServer = (): Server => serverSelect.current();
  const session = createSession({ http, secretBox, clock, kv, servers, activeServer });
  await session.adopt(wireSession(activeServer()));
  const api = createApi({ http, session, servers, serverSelect });
  const random = fakeRandom(...randomValues);
  const store = createReplicaStore();
  const apply = createReplicaApply({ driver, store, clock });
  hydrateReplica({ driver, store, clock });
  const kick = jest.fn<void, ['mutation']>();
  const events = createSyncEvents();
  const mutations = createMutations({ driver, apply, clock, ids, sessionUser, kick });
  const drain = createOutbox({ driver, apply, api, clock, random, sessionUser, events });
  return {
    driver, clock, ids, factory, sessionUser, kv, http, secretBox, session, api, serverSelect,
    random, store, apply, kick, events, mutations, drain,
    replica: new ReplicaRepo(driver), outbox: new OutboxRepo(driver),
    deadLetter: new DeadLetterRepo(driver),
  };
}

export type SyncContext = Awaited<ReturnType<typeof syncContext>>;

export function petMutation(c: SyncContext, name: string): Mutation {
  const row = c.factory.pets({ name, revision: null, created_by: c.sessionUser.id });
  return {
    clientMutationId: c.ids.uuid(), method: 'POST', path: '/pets',
    body: { id: row.id, name, species: row.species }, entity: 'pets', entityId: row.id,
    localRow: row,
  };
}

export function seedMutation(c: SyncContext, mutation: Mutation) {
  c.driver.transaction(() => {
    if (mutation.localRow === null) c.apply.removeRow(mutation.entity, mutation.entityId);
    else c.apply.applyLocalRow(mutation.entity, mutation.localRow);
    c.outbox.insert({ ...mutation, userId: c.sessionUser.id, createdAt: c.clock.now() });
  });
  const head = c.outbox.head(c.sessionUser.id);
  if (head === null) throw new Error('Seeded mutation is missing');
  return head;
}

export function queued(c: SyncContext) {
  const snapshot = c.driver.all<{ seq: number; entityId: string; method: string; path: string; body: string | null }>(
    'SELECT seq, entity_id AS entityId, method, path, body FROM outbox ORDER BY seq',
  );
  return snapshot.map((entry) => ({ ...entry, body: entry.body === null ? null : JSON.parse(entry.body) as unknown }));
}

export function failure(status: number): ApiResult {
  return { ok: false, status, body: { code: 'validation_error', detail: 'Invalid mutation.' }, headers: {} };
}
