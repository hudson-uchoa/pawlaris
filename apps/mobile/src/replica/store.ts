import type {
  Asset, Completion, Family, HealthEvent, Member, Pet, TaskTemplate,
  Timer, Walk, WeightEntry,
} from '@pawlaris/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { registerReplicaStore } from './apply';

export interface ReplicaState {
  ready: boolean;
  family: Family | null;
  members: Record<string, Member>;
  pets: Record<string, Pet>;
  weightEntries: Record<string, WeightEntry>;
  healthEvents: Record<string, HealthEvent>;
  taskTemplates: Record<string, TaskTemplate>;
  completions: Record<string, Completion>;
  timers: Record<string, Timer>;
  walks: Record<string, Walk>;
  assets: Record<string, Asset>;
  pending: Record<string, true>;
}

export type ReplicaStore = Pick<StoreApi<ReplicaState>,
  'getState' | 'getInitialState' | 'subscribe'>;

export function createReplicaStore(): ReplicaStore {
  return registerReplicaStore(createStore<ReplicaState>(() => ({
    ready: false, family: null, members: {}, pets: {}, weightEntries: {}, healthEvents: {},
    taskTemplates: {}, completions: {}, timers: {}, walks: {}, assets: {}, pending: {},
  })));
}
