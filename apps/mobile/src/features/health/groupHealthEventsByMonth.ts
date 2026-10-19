import { localDate, type HealthEvent } from '@pawlaris/shared';

export type HealthMonth = {
  month: string;
  events: readonly HealthEvent[];
};

export function groupHealthEventsByMonth(
  events: readonly HealthEvent[], timezone: string,
): readonly HealthMonth[] {
  const months = new Map<string, HealthEvent[]>();
  const newestFirst = [...events].sort((a, b) =>
    Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || a.id.localeCompare(b.id));
  for (const event of newestFirst) {
    const month = localDate(Date.parse(event.occurred_at), timezone).slice(0, 7);
    const entries = months.get(month);
    if (entries === undefined) months.set(month, [event]);
    else entries.push(event);
  }
  return [...months].sort(([a], [b]) => b.localeCompare(a))
    .map(([month, entries]) => ({ month, events: entries }));
}
