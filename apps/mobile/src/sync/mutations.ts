import type {
  AuthUser, Completion, DateKey, HealthEvent, Pet, TaskEdits, TaskTemplate,
  Timer, Walk, WeightEntry,
} from '@pawlaris/shared';
import type { SqlDriver } from '../db/driver';
import type { RoutePoint } from '../db/walkRepo';
import type { EntityRows, SyncEntity } from '../db/replicaRepo';
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
  'name' | 'species' | 'sex' | 'breed' | 'color' | 'birthdate'
  | 'microchip_id' | 'avatar_asset_id' | 'notes' | 'sort_order'>;
export type PetCreate = Pick<PetFields, 'name' | 'species'>
  & Partial<Omit<PetFields, 'name' | 'species'>>;
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

export function createMutations(_dependencies: MutationDependencies): Mutations {
  return {
    enqueue(..._mutations) { throw new Error('not implemented'); },
    createPet(_body) { throw new Error('not implemented'); },
    patchPet(_id, _body) { throw new Error('not implemented'); },
    archivePet(_id) { throw new Error('not implemented'); },
    unarchivePet(_id) { throw new Error('not implemented'); },
    createWeight(_body) { throw new Error('not implemented'); },
    deleteWeight(_id) { throw new Error('not implemented'); },
    createHealthEvent(_body) { throw new Error('not implemented'); },
    patchHealthEvent(_id, _body) { throw new Error('not implemented'); },
    deleteHealthEvent(_id) { throw new Error('not implemented'); },
    createTask(_body) { throw new Error('not implemented'); },
    patchTask(_id, _body) { throw new Error('not implemented'); },
    deleteTask(_id) { throw new Error('not implemented'); },
    forkTask(_id, _edits, _effectiveDate) { throw new Error('not implemented'); },
    createCompletion(_body) { throw new Error('not implemented'); },
    undoCompletion(_id) { throw new Error('not implemented'); },
    startTimer(_body) { throw new Error('not implemented'); },
    cancelTimer(_id) { throw new Error('not implemented'); },
    startWalk(_body) { throw new Error('not implemented'); },
    finishWalk(_id, _body) { throw new Error('not implemented'); },
    discardWalk(_id) { throw new Error('not implemented'); },
  };
}
