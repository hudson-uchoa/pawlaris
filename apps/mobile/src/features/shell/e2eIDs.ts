// Q-64: proposed selectors absent from spec/09. Keep naming in this one place.
export const e2eIDs = {
  tab: (name: string): string => `tab-${name}`,
  speciesDog: 'pet-species-dog',
  intervalIncrease: 'task-interval-increase',
  taskPet: (id: string): string => `task-form-pet-${id}`,
  attribution: (taskId: string, key: string): string => `task-attribution-${taskId}-${key}`,
  photoState: (state: string | null): string => `photo-state-${state ?? 'unknown'}`,
  syncState: (status: string, count: number): string => `sync-state-${status}-${count}`,
};
