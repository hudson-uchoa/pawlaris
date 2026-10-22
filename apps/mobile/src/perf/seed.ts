import { localDate } from '@pawlaris/shared';
import type { SqlDriver } from '../db/driver';
import { strings } from '../i18n/strings';
import type { Clock } from '../platform/clock';
import type { ReplicaStore } from '../replica/store';
import type { Mutations } from '../sync/mutations';

export interface PerfSeedDependencies {
  driver: SqlDriver;
  clock: Clock;
  store: ReplicaStore;
  mutations: Mutations;
}

const SEED_TAG = 'pawlaris-performance-seed';

export function seedPerformance({ driver, clock, store, mutations }: PerfSeedDependencies): void {
  const state = store.getState();
  if (state.family === null || !state.ready) throw new Error('Performance seed requires a hydrated family');
  const today = localDate(clock.now(), state.family.timezone);
  const existing = Object.values(state.taskTemplates).filter((task) => task.description === SEED_TAG
    && task.starts_on === today && task.deleted_at === null);
  driver.transaction(() => {
    const petId = Object.values(state.pets).find((pet) => pet.notes === SEED_TAG
      && pet.archived_at === null && pet.deleted_at === null)?.id
      ?? mutations.createPet({ name: strings.diagnostics.perfPet, species: 'cat', notes: SEED_TAG });
    for (let index = existing.length; index < 90; index += 1) {
      mutations.createTask({ title: strings.diagnostics.perfTask(index + 1), description: SEED_TAG,
        recurrence: { freq: 'once', date: today }, starts_on: today, pet_ids: [petId],
        completion_mode: 'together', times_of_day: [], assigned_to: null, sort_order: index });
    }
  });
}
