import type {
  AuthUser, Completion, DateKey, HealthEvent, Pet, TaskEdits, TaskTemplate,
  Timer, Walk, WeightEntry,
} from '@pawlaris/shared';
import { buildFork } from '@pawlaris/shared';
import type { SqlDriver } from '../db/driver';
import { OutboxRepo } from '../db/outboxRepo';
import type { RoutePoint } from '../db/walkRepo';
import { ReplicaRepo, type EntityRows, type SyncEntity } from '../db/replicaRepo';
import type { Clock } from '../platform/clock';
import type { IdGen } from '../platform/idGen';
import type { ReplicaApply } from '../replica/apply';

export type Mutation = {
  [E in SyncEntity]: {
    clientMutationId: string;
    method: 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body: unknown | null;
    entity: E;
    entityId: string;
    localRow: EntityRows[E] | null;
  }
}[SyncEntity];

type PetFields = Pick<Pet,
  'name' | 'species' | 'sex' | 'breed' | 'color' | 'identity_color' | 'birthdate'
  | 'microchip_id' | 'avatar_asset_id' | 'notes' | 'sort_order'>;
export type PetCreate = Pick<PetFields, 'name' | 'species'>
  & Partial<Omit<PetFields, 'name' | 'species'>> & { id?: string };
export type PetPatch = Partial<Omit<PetFields, 'species'>>;
export type WeightCreate = Pick<WeightEntry, 'pet_id' | 'weight_kg' | 'measured_at'>
  & Partial<Pick<WeightEntry, 'note'>>;
type HealthFields = Pick<HealthEvent,
  'pet_id' | 'type' | 'title' | 'notes' | 'occurred_at' | 'next_due_on' | 'attachment_asset_id'>;
export type HealthEventCreate = Pick<HealthFields, 'pet_id' | 'type' | 'title' | 'occurred_at'>
  & Partial<Pick<HealthFields, 'notes' | 'next_due_on' | 'attachment_asset_id'>>;
export type HealthEventPatch = Partial<Omit<HealthFields, 'pet_id'>>;
type TaskFields = Omit<TaskTemplate,
  'id' | 'revision' | 'updated_at' | 'deleted_at' | 'created_by'>;
export type TaskCreate = Pick<TaskFields, 'title' | 'recurrence' | 'starts_on' | 'pet_ids'>
  & Partial<Omit<TaskFields, 'title' | 'recurrence' | 'starts_on' | 'pet_ids'>>;
export type TaskPatch = Partial<Pick<TaskFields,
  'title' | 'description' | 'category' | 'assigned_to' | 'requires_photo'
  | 'timer_seconds' | 'reminder_class' | 'sort_order' | 'ends_on'>>;
export type CompletionCreate = Pick<Completion,
  'task_id' | 'occurrence_key' | 'pet_id' | 'completed_at' | 'photo_asset_id' | 'note'>;
export type TimerCreate = Pick<Timer, 'task_id' | 'occurrence_key' | 'started_at' | 'ends_at'>
  & Partial<Pick<Timer, 'pet_id'>>;
export type WalkCreate = Pick<Walk, 'pet_id' | 'started_at'>;
export type WalkFinish = Pick<Walk,
  'pet_id' | 'started_at' | 'paused_ms' | 'distance_m' | 'duration_s'
  | 'avg_pace_s_per_km' | 'preview'>
  & { ended_at: string; note?: string | null; route: RoutePoint[] };

export interface Mutations {
  reservePetId(): string;
  enqueue(...mutations: Mutation[]): void;
  createPet(body: PetCreate): string;
  patchPet(id: string, body: PetPatch): void;
  archivePet(id: string): void;
  unarchivePet(id: string): void;
  createWeight(body: WeightCreate): string;
  deleteWeight(id: string): void;
  createHealthEvent(body: HealthEventCreate): string;
  patchHealthEvent(id: string, body: HealthEventPatch): void;
  deleteHealthEvent(id: string): void;
  createTask(body: TaskCreate): string;
  patchTask(id: string, body: TaskPatch): void;
  deleteTask(id: string): void;
  forkTask(id: string, edits: TaskEdits, effectiveDate: DateKey): string;
  createCompletion(body: CompletionCreate): string;
  undoCompletion(id: string): void;
  startTimer(body: TimerCreate): string;
  cancelTimer(id: string): void;
  startWalk(body: WalkCreate): string;
  finishWalk(id: string, body: WalkFinish): void;
  discardWalk(id: string): void;
}

export interface MutationDependencies {
  driver: SqlDriver;
  apply: ReplicaApply;
  clock: Clock;
  ids: IdGen;
  sessionUser: Pick<AuthUser, 'id'>;
  kick(reason: 'mutation'): void;
}

export function createMutations({ driver, apply, clock, ids, sessionUser, kick }: MutationDependencies): Mutations {
  const replica = new ReplicaRepo(driver);
  const outbox = new OutboxRepo(driver);
  let needsKick = false;
  driver.onTransactionEnd((committed) => {
    const pending = needsKick;
    needsKick = false;
    if (committed && pending) kick('mutation');
  });

  const now = () => new Date(clock.now()).toISOString();
  const base = (id: string, updated_at: string) => ({ id, revision: null, updated_at });
  const current = <E extends SyncEntity>(entity: E, id: string): EntityRows[E] => {
    const record = replica.get(entity, id);
    if (record === null) throw new Error(`Missing local ${entity} row`);
    return record.row;
  };

  const enqueue = (...mutations: Mutation[]): void => {
    driver.transaction(() => {
      for (const mutation of mutations) {
        if (mutation.localRow === null) apply.removeRow(mutation.entity, mutation.entityId);
        else apply.applyLocalRow(mutation.entity, mutation.localRow);
        outbox.insert({ ...mutation, userId: sessionUser.id, createdAt: clock.now() });
      }
      needsKick = true;
    });
  };

  const mutation = <E extends SyncEntity>(
    entity: E, entityId: string, method: Mutation['method'], path: string,
    body: unknown | null, localRow: EntityRows[E] | null,
  ): Mutation => ({
    clientMutationId: ids.uuid(), entity, entityId, method, path, body, localRow,
    // E binds the row to its entity; TypeScript cannot expand the mapped union here.
  } as Mutation);

  const create = <E extends SyncEntity>(
    entity: E, path: string, body: object,
    buildRow: (id: string, updatedAt: string) => EntityRows[E],
    reservedId?: string,
  ): string => driver.transaction(() => {
    const id = reservedId ?? ids.uuid();
    enqueue(mutation(entity, id, 'POST', path, { id, ...body }, buildRow(id, now())));
    return id;
  });

  const edit = <E extends SyncEntity>(
    entity: E, id: string, path: string, fields: Partial<EntityRows[E]>,
    body: unknown | null, method: 'POST' | 'PATCH' = 'POST',
  ): void => {
    driver.transaction(() => {
      const row = { ...current(entity, id), ...fields, updated_at: now() };
      enqueue(mutation(entity, id, method, path, body, row));
    });
  };

  const remove = (entity: SyncEntity, id: string, path: string, method: 'DELETE' | 'POST' = 'DELETE'): void => {
    driver.transaction(() => { enqueue(mutation(entity, id, method, path, null, null)); });
  };

  const taskRow = (id: string, body: TaskCreate, updatedAt: string): TaskTemplate => ({
    description: null, category: 'other', assigned_to: null, requires_photo: false,
    timer_seconds: null, reminder_class: 'routine', sort_order: 0, times_of_day: [],
    completion_mode: 'together', ends_on: null, replaces_task_id: null,
    ...body, ...base(id, updatedAt), created_by: sessionUser.id, deleted_at: null,
  });

  const walkRow = (id: string, body: WalkCreate, updatedAt: string): Walk => ({
    pet_id: body.pet_id, started_at: body.started_at,
    ...base(id, updatedAt), user_id: sessionUser.id, status: 'active',
    ended_at: null, paused_ms: 0, distance_m: 0, duration_s: 0,
    avg_pace_s_per_km: null, point_count: 0, has_route: false, preview: [], note: null, deleted_at: null,
  });

  return {
    reservePetId: () => ids.uuid(),
    enqueue,
    createPet: (body) => create('pets', '/pets', body, (id, updatedAt) => ({
      sex: 'unknown', breed: null, color: null, identity_color: null,
      birthdate: null, microchip_id: null,
      avatar_asset_id: null, notes: null, sort_order: 0, ...body, ...base(id, updatedAt),
      archived_at: null, created_by: sessionUser.id, deleted_at: null,
    }), body.id),
    patchPet: (id, body) => edit('pets', id, `/pets/${id}`, body, body, 'PATCH'),
    archivePet(id) {
      driver.transaction(() => { edit('pets', id, `/pets/${id}/archive`, { archived_at: now() }, null); });
    },
    unarchivePet: (id) => edit('pets', id, `/pets/${id}/unarchive`, { archived_at: null }, null),
    createWeight: (body) => create('weight_entries', '/weights', body, (id, updatedAt) => ({
      note: null, ...body, ...base(id, updatedAt), created_by: sessionUser.id, deleted_at: null,
    })),
    deleteWeight: (id) => remove('weight_entries', id, `/weights/${id}`),
    createHealthEvent: (body) => create('health_events', '/health-events', body, (id, updatedAt) => ({
      notes: null, next_due_on: null, attachment_asset_id: null,
      ...body, ...base(id, updatedAt), created_by: sessionUser.id, deleted_at: null,
    })),
    patchHealthEvent: (id, body) => edit('health_events', id, `/health-events/${id}`, body, body, 'PATCH'),
    deleteHealthEvent: (id) => remove('health_events', id, `/health-events/${id}`),
    createTask: (body) => create('task_templates', '/tasks', body, (id, updatedAt) => taskRow(id, body, updatedAt)),
    patchTask: (id, body) => edit('task_templates', id, `/tasks/${id}`, body, body, 'PATCH'),
    deleteTask: (id) => remove('task_templates', id, `/tasks/${id}`),
    forkTask(id, edits, effectiveDate) {
      return driver.transaction(() => {
        const old = current('task_templates', id);
        const newId = ids.uuid();
        const { newTemplate, oldPatch } = buildFork(old, edits, effectiveDate, newId);
        const updatedAt = now();
        enqueue(
          mutation('task_templates', newId, 'POST', '/tasks', newTemplate,
            taskRow(newId, newTemplate, updatedAt)),
          mutation('task_templates', id, 'PATCH', `/tasks/${id}`, oldPatch,
            { ...old, ...oldPatch, updated_at: updatedAt }),
        );
        return newId;
      });
    },
    createCompletion: (body) => create('task_completions', '/completions', body, (id, updatedAt) => ({
      ...body, ...base(id, updatedAt), completed_by: sessionUser.id,
      title_snapshot: current('task_templates', body.task_id).title,
      undone_at: null, undone_by: null, duplicate_of: null,
    })),
    undoCompletion(id) {
      driver.transaction(() => {
        edit('task_completions', id, `/completions/${id}/undo`, { undone_at: now(), undone_by: sessionUser.id }, null);
      });
    },
    startTimer: (body) => create('task_timers', '/timers', body, (id, updatedAt) => ({
      pet_id: null, ...body, ...base(id, updatedAt), started_by: sessionUser.id, cancelled_at: null,
    })),
    cancelTimer(id) {
      driver.transaction(() => { edit('task_timers', id, `/timers/${id}/cancel`, { cancelled_at: now() }, null); });
    },
    startWalk: (body) => create('walk_sessions', '/walks', body, (id, updatedAt) => walkRow(id, body, updatedAt)),
    finishWalk(id, body) {
      driver.transaction(() => {
        const updatedAt = now();
        const old = replica.get('walk_sessions', id)?.row ?? walkRow(id, body, updatedAt);
        const { route, ...fields } = body;
        const row: Walk = {
          ...old, ...fields, note: body.note ?? null, status: 'finished',
          point_count: route.length, has_route: route.length > 0, updated_at: updatedAt,
        };
        enqueue(mutation('walk_sessions', id, 'POST', `/walks/${id}/finish`, body, row));
      });
    },
    discardWalk: (id) => remove('walk_sessions', id, `/walks/${id}/discard`, 'POST'),
  };
}
