export type DateKey = string;
export type CalendarDate = { y: number; m: number; d: number };

function notImplemented(...inputs: unknown[]): never {
  void inputs;
  throw new Error('not implemented');
}

export function isDateKey(key: string): boolean {
  return notImplemented(key);
}

export function parseDateKey(key: DateKey): CalendarDate {
  return notImplemented(key);
}

export function formatDateKey(date: CalendarDate): DateKey {
  return notImplemented(date);
}

export function addDays(key: DateKey, n: number): DateKey {
  return notImplemented(key, n);
}

export function daysBetween(a: DateKey, b: DateKey): number {
  return notImplemented(a, b);
}

export function weekdayOf(key: DateKey): number {
  return notImplemented(key);
}

export function mondayOf(key: DateKey): DateKey {
  return notImplemented(key);
}

export function daysInMonth(y: number, m: number): number {
  return notImplemented(y, m);
}

export function monthsBetween(a: DateKey, b: DateKey): number {
  return notImplemented(a, b);
}

export function compareDateKey(a: DateKey, b: DateKey): number {
  return notImplemented(a, b);
}
