import type { DateKey } from './dates';
import type { HealthEvent, Pet } from './entities';

export type PetAge = { years: number; months: number; days: number };
export type UpcomingCareInput = {
  healthEvents: readonly HealthEvent[];
  pets: readonly Pet[];
  today: DateKey;
};
export type UpcomingCareItem = HealthEvent & { daysUntil: number };

export function petAge(_birthdate: DateKey, _today: DateKey): PetAge {
  void _birthdate;
  void _today;
  throw new Error('not implemented');
}

export function needsWeightConfirmation(_prevKg: number | null, _nextKg: number): boolean {
  void _prevKg;
  void _nextKg;
  throw new Error('not implemented');
}

export function upcomingCare(_input: UpcomingCareInput): UpcomingCareItem[] {
  void _input;
  throw new Error('not implemented');
}
