import type { WeightEntry } from '@pawlaris/shared';

export function petWeights(entries: Readonly<Record<string, WeightEntry>>, petId: string): WeightEntry[] {
  return Object.values(entries).filter((entry) => entry.pet_id === petId && entry.deleted_at === null)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at) || a.id.localeCompare(b.id));
}
