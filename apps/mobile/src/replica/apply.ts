import { addDays, localDate, type Family } from '@pawlaris/shared';
import type { StoreApi } from 'zustand/vanilla';
import type { SqlDriver } from '../db/driver';
import { Kv } from '../db/kv';
import { OutboxRepo } from '../db/outboxRepo';
import { ReplicaRepo, type EntityRows, type ReplicaRecord, type SyncEntity } from '../db/replicaRepo';
import type { ReplicaState, ReplicaStore } from './store';

export interface Clock {
  now(): number;
}

export interface ReplicaDependencies {
  driver: SqlDriver;
  store: ReplicaStore;
  clock: Clock;
}

export type ServerChange = {
  [E in SyncEntity]: { entity: E; row: EntityRows[E] }
}[SyncEntity];

export interface ServerApplyOptions {
  cursor?: number;
  pullGen?: number;
}

export interface ReplicaApply {
  applyServerRows(changes: readonly ServerChange[], opts?: ServerApplyOptions): void;
  applyLocalRow<E extends SyncEntity>(entity: E, row: EntityRows[E]): void;
  removeRow(entity: SyncEntity, id: string): void;
}

const writers = new WeakMap<ReplicaStore, StoreApi<ReplicaState>>();

// Keep the vanilla setter private to this module; React receives only readers.
export function registerReplicaStore(api: StoreApi<ReplicaState>): ReplicaStore {
  const store = { getState: api.getState, getInitialState: api.getInitialState, subscribe: api.subscribe };
  writers.set(store, api);
  return store;
}

type StateUpdate = (state: ReplicaState) => ReplicaState;
interface Batch {
  updates: Map<ReplicaStore, StateUpdate[]>;
}
const batches = new WeakMap<SqlDriver, Batch>();

function coordinateTransactions(driver: SqlDriver): Batch {
  const existing = batches.get(driver);
  if (existing !== undefined) return existing;
  const batch: Batch = { updates: new Map() };
  const transaction = driver.transaction.bind(driver);
  let depth = 0;
  driver.transaction = <T>(fn: () => T): T => {
    const outermost = depth === 0;
    depth += 1;
    const prepared: { api: StoreApi<ReplicaState>; state: ReplicaState }[] = [];
    let result: T;
    try {
      result = transaction(() => {
        const value = fn();
        if (outermost) {
          for (const [store, updates] of batch.updates) {
            const api = writers.get(store);
            if (api === undefined) throw new Error('Replica store is not registered');
            const state = updates.reduce((previous, update) => update(previous), store.getState());
            prepared.push({ api, state });
          }
        }
        return value;
      });
    } finally {
      depth -= 1;
      if (outermost) batch.updates.clear();
    }
    // The underlying outer transaction has returned only after COMMIT succeeds.
    for (const { api, state } of prepared) api.setState(state, true);
    return result;
  };
  batches.set(driver, batch);
  return batch;
}

function collect(dependencies: ReplicaDependencies, update: StateUpdate): void {
  const batch = coordinateTransactions(dependencies.driver);
  const updates = batch.updates.get(dependencies.store) ?? [];
  updates.push(update);
  batch.updates.set(dependencies.store, updates);
}

const slices = {
  members: 'members', pets: 'pets', weight_entries: 'weightEntries', health_events: 'healthEvents',
  task_templates: 'taskTemplates', task_completions: 'completions', task_timers: 'timers',
  walk_sessions: 'walks', assets: 'assets',
} as const;

function withoutRow(state: ReplicaState, entity: SyncEntity, id: string): ReplicaState {
  const pending = { ...state.pending };
  delete pending[`${entity}:${id}`];
  if (entity === 'family') {
    return { ...state, family: state.family?.id === id ? null : state.family, pending };
  }
  const slice = slices[entity];
  const rows = { ...state[slice] };
  delete rows[id];
  return { ...state, [slice]: rows, pending };
}

function withRow(state: ReplicaState, change: ServerChange, pendingRow: boolean): ReplicaState {
  const pending = { ...state.pending };
  const key = `${change.entity}:${change.row.id}`;
  if (pendingRow) pending[key] = true;
  else delete pending[key];
  if (change.entity === 'family') return { ...state, family: change.row, pending };
  const slice = slices[change.entity];
  return { ...state, [slice]: { ...state[slice], [change.row.id]: change.row }, pending };
}

function completionCutoff(dependencies: ReplicaDependencies): string {
  const family = dependencies.driver.all<{ json: string }>(
    "SELECT json FROM replica WHERE entity = 'family' AND deleted = 0 LIMIT 1",
  )[0];
  // Before the family arrives, use the seeded family's timezone (02, Family).
  const timezone = family === undefined ? 'America/Sao_Paulo' : (JSON.parse(family.json) as Family).timezone;
  return addDays(localDate(dependencies.clock.now(), timezone), -120);
}

function queueRecord(dependencies: ReplicaDependencies, record: ReplicaRecord): void {
  const visible = !record.deleted && (record.entity !== 'task_completions'
    || (record.sortKey !== null && record.sortKey >= completionCutoff(dependencies)));
  // ReplicaRepo decodes each entity's JSON as that entity's row type.
  const change = { entity: record.entity, row: record.row } as ServerChange;
  collect(dependencies, (state) => visible
    ? withRow(state, change, record.pending) : withoutRow(state, record.entity, record.id));
}

export function createReplicaApply(dependencies: ReplicaDependencies): ReplicaApply {
  const { driver } = dependencies;
  coordinateTransactions(driver);
  const replica = new ReplicaRepo(driver);
  const outbox = new OutboxRepo(driver);
  const kv = new Kv(driver);
  const write = <E extends SyncEntity>(entity: E, row: EntityRows[E], pending: boolean, pullGen: number) => {
    const deleted = 'deleted_at' in row && row.deleted_at !== null;
    replica.upsert(entity, row, { pending, deleted, pullGen });
    const record = replica.get(entity, row.id);
    if (record === null) throw new Error('Replica write did not persist its row');
    queueRecord(dependencies, record);
  };
  return {
    applyServerRows(changes, opts = {}) {
      driver.transaction(() => {
        const pullGen = opts.pullGen ?? Number(kv.get('pull_gen') ?? 0);
        for (const { entity, row } of changes) {
          if (outbox.hasEntryFor(entity, row.id)) continue;
          write(entity, row, false, pullGen);
        }
        if (opts.cursor !== undefined) {
          const server = kv.get('active_server') ?? 'primary';
          kv.set(`last_revision.${server}`, String(opts.cursor));
        }
      });
    },
    applyLocalRow(entity, row) {
      driver.transaction(() => {
        write(entity, row, true, Number(kv.get('pull_gen') ?? 0));
      });
    },
    removeRow(entity, id) {
      driver.transaction(() => {
        replica.remove(entity, id);
        collect(dependencies, (state) => withoutRow(state, entity, id));
      });
    },
  };
}

export function hydrateReplica(dependencies: ReplicaDependencies): void {
  coordinateTransactions(dependencies.driver);
  dependencies.driver.transaction(() => {
    const rows = new ReplicaRepo(dependencies.driver).allExceptOldCompletions(completionCutoff(dependencies));
    collect(dependencies, () => ({ ...dependencies.store.getInitialState(), ready: true }));
    for (const record of rows) queueRecord(dependencies, record);
  });
}
