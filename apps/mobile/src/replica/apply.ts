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

type StateUpdate =
  | { kind: 'upsert'; change: ServerChange; pending: boolean }
  | { kind: 'remove'; entity: SyncEntity; id: string }
  | { kind: 'hydrate'; rows: ReplicaRecord[] };
interface ReplicaWriter {
  api: StoreApi<ReplicaState>;
  batches: Map<SqlDriver, StateUpdate[]>;
}
const writers = new WeakMap<ReplicaStore, ReplicaWriter>();
interface CutoffCache {
  value: string | undefined;
}
const completionCutoffs = new WeakMap<SqlDriver, CutoffCache>();

function transactionCutoffCache(driver: SqlDriver): CutoffCache {
  const existing = completionCutoffs.get(driver);
  if (existing !== undefined) return existing;
  const cache: CutoffCache = { value: undefined };
  completionCutoffs.set(driver, cache);
  driver.onTransactionEnd(() => { cache.value = undefined; });
  return cache;
}

// Keep the vanilla setter private to this module; React receives only readers.
export function registerReplicaStore(api: StoreApi<ReplicaState>): ReplicaStore {
  const store = { getState: api.getState, getInitialState: api.getInitialState, subscribe: api.subscribe };
  writers.set(store, { api, batches: new Map() });
  return store;
}

function transactionUpdates({ driver, store }: ReplicaDependencies): StateUpdate[] {
  const writer = writers.get(store);
  if (writer === undefined) throw new Error('Replica store is not registered');
  const existing = writer.batches.get(driver);
  if (existing !== undefined) return existing;
  // Clear the cutoff before a store notification can start another transaction.
  transactionCutoffCache(driver);
  const updates: StateUpdate[] = [];
  writer.batches.set(driver, updates);
  driver.onTransactionEnd((committed) => {
    const pending = updates.splice(0);
    if (!committed || pending.length === 0) return;
    writer.api.setState(buildState(store, pending), true);
  });
  return updates;
}

function collect(dependencies: ReplicaDependencies, update: StateUpdate): void {
  transactionUpdates(dependencies).push(update);
}

const slices = {
  members: 'members', pets: 'pets', weight_entries: 'weightEntries', health_events: 'healthEvents',
  task_templates: 'taskTemplates', task_completions: 'completions', task_timers: 'timers',
  walk_sessions: 'walks', assets: 'assets',
} as const;

function buildState(store: ReplicaStore, updates: StateUpdate[]): ReplicaState {
  let hydrated: ReplicaRecord[] | undefined;
  let start = 0;
  // A hydrate snapshot supersedes earlier queued changes from this transaction.
  for (const [index, update] of updates.entries()) {
    if (update.kind === 'hydrate') {
      hydrated = update.rows;
      start = index + 1;
    }
  }
  const base = hydrated === undefined ? store.getState() : store.getInitialState();
  const state = { ...base, pending: { ...base.pending }, ready: hydrated === undefined ? base.ready : true };
  type Slice = typeof slices[keyof typeof slices];
  const copied = new Set<Slice>();
  function mutableSlice<S extends Slice>(slice: S): ReplicaState[S] {
    if (!copied.has(slice)) {
      state[slice] = { ...state[slice] };
      copied.add(slice);
    }
    return state[slice];
  }

  function withoutRow(entity: SyncEntity, id: string): void {
    delete state.pending[`${entity}:${id}`];
    if (entity === 'family') {
      if (state.family?.id === id) state.family = null;
    } else {
      delete mutableSlice(slices[entity])[id];
    }
  }

  function withRow(change: ServerChange, pendingRow: boolean): void {
    const key = `${change.entity}:${change.row.id}`;
    if (pendingRow) state.pending[key] = true;
    else delete state.pending[key];
    if (change.entity === 'family') state.family = change.row;
    else mutableSlice(slices[change.entity])[change.row.id] = change.row;
  }

  if (hydrated !== undefined) {
    for (const record of hydrated) {
      // ReplicaRepo decodes each entity's JSON as that entity's row type.
      withRow({ entity: record.entity, row: record.row } as ServerChange, record.pending);
    }
  }
  for (const update of updates.slice(start)) {
    if (update.kind === 'upsert') withRow(update.change, update.pending);
    else if (update.kind === 'remove') withoutRow(update.entity, update.id);
  }
  return state;
}

function completionCutoff(dependencies: ReplicaDependencies): string {
  const cache = transactionCutoffCache(dependencies.driver);
  if (cache.value !== undefined) return cache.value;
  const family = dependencies.driver.all<{ json: string }>(
    "SELECT json FROM replica WHERE entity = 'family' AND deleted = 0 LIMIT 1",
  )[0];
  // Before the family arrives, use the seeded family's timezone (02, Family).
  const timezone = family === undefined ? 'America/Sao_Paulo' : (JSON.parse(family.json) as Family).timezone;
  cache.value = addDays(localDate(dependencies.clock.now(), timezone), -120);
  return cache.value;
}

function queueRecord(dependencies: ReplicaDependencies, record: ReplicaRecord): void {
  const visible = !record.deleted && (record.entity !== 'task_completions'
    || (record.sortKey !== null && record.sortKey >= completionCutoff(dependencies)));
  // ReplicaRepo decodes each entity's JSON as that entity's row type.
  const change = { entity: record.entity, row: record.row } as ServerChange;
  collect(dependencies, visible
    ? { kind: 'upsert', change, pending: record.pending }
    : { kind: 'remove', entity: record.entity, id: record.id });
}

export function createReplicaApply(dependencies: ReplicaDependencies): ReplicaApply {
  const { driver } = dependencies;
  transactionUpdates(dependencies);
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
        collect(dependencies, { kind: 'remove', entity, id });
      });
    },
  };
}

export function hydrateReplica(dependencies: ReplicaDependencies): void {
  transactionUpdates(dependencies);
  dependencies.driver.transaction(() => {
    const rows = new ReplicaRepo(dependencies.driver).allExceptOldCompletions(completionCutoff(dependencies));
    collect(dependencies, { kind: 'hydrate', rows });
  });
}
