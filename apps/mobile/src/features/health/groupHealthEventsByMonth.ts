import type { HealthEvent } from '@pawlaris/shared';

export type HealthMonth = {
  month: string;
  events: readonly HealthEvent[];
};

export function groupHealthEventsByMonth(
  _events: readonly HealthEvent[], _timezone: string,
): readonly HealthMonth[] {
  throw new Error('not implemented');
}
