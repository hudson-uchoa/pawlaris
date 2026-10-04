import type { DateKey } from './dates';

type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export type Recurrence =
  | { freq: 'daily'; interval: number }
  | { freq: 'weekly'; interval: number; byday: Weekday[] }
  | { freq: 'monthly'; interval: number; bymonthday: number[] }
  | { freq: 'once'; date: DateKey };

export type OccurrenceInput = {
  recurrence: Recurrence;
  timesOfDay: string[];
  startsOn: DateKey;
  endsOn: DateKey | null;
  from: DateKey;
  to: DateKey;
};

// Q-7: validators return English string errors; malformed keys throw RangeError.
type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validateRecurrence(value: unknown, startsOn: DateKey): ValidationResult<Recurrence> {
  void value;
  void startsOn;
  throw new Error('not implemented');
}

export function validateTimesOfDay(value: unknown): ValidationResult<string[]> {
  void value;
  throw new Error('not implemented');
}

export function occurrences(input: OccurrenceInput): string[] {
  void input;
  throw new Error('not implemented');
}

export function splitKey(key: string): { date: DateKey; time: string | null } {
  void key;
  throw new Error('not implemented');
}
