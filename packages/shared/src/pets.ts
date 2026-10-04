import { daysBetween, daysInMonth, formatDateKey, monthsBetween, parseDateKey, type DateKey } from './dates';
import type { HealthEvent, Pet } from './entities';

export type PetAge = { years: number; months: number; days: number };
export type UpcomingCareInput = {
  healthEvents: readonly HealthEvent[];
  pets: readonly Pet[];
  today: DateKey;
};
export type UpcomingCareItem = HealthEvent & { daysUntil: number };

export function petAge(birthdate: DateKey, today: DateKey): PetAge {
  const birth = parseDateKey(birthdate);
  parseDateKey(today);
  if (birthdate > today) throw new RangeError('Birthdate must not be in the future.');
  // Q-12: count whole months from the birth day, clamped at short month ends.
  const anniversary = (months: number): DateKey => {
    const monthIndex = birth.m - 1 + months;
    const y = birth.y + Math.floor(monthIndex / 12);
    const m = monthIndex % 12 + 1;
    return formatDateKey({ y, m, d: Math.min(birth.d, daysInMonth(y, m)) });
  };
  let months = monthsBetween(birthdate, today);
  if (anniversary(months) > today) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12, days: daysBetween(anniversary(months), today) };
}

export function needsWeightConfirmation(prevKg: number | null, nextKg: number): boolean {
  if (prevKg === null) return false;
  const difference = Math.abs(nextKg - prevKg);
  const threshold = prevKg * 0.2;
  // Equality at 20% can round slightly upward for decimal kilogram values.
  return difference - threshold > Number.EPSILON * Math.max(prevKg, nextKg);
}

export function upcomingCare({ healthEvents, pets, today }: UpcomingCareInput): UpcomingCareItem[] {
  const activePets = new Set(pets.filter((pet) => pet.archived_at === null && pet.deleted_at === null)
    .map((pet) => pet.id));
  const items: UpcomingCareItem[] = [];
  for (const event of healthEvents) {
    if (event.deleted_at !== null || event.next_due_on === null || !activePets.has(event.pet_id)) continue;
    const daysUntil = daysBetween(today, event.next_due_on);
    if (daysUntil <= 7) items.push({ ...event, daysUntil });
  }
  return items.sort((a, b) => a.daysUntil - b.daysUntil || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
