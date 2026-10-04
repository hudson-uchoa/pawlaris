import type { DateKey } from './dates';

function notImplemented(...inputs: unknown[]): never {
  void inputs;
  throw new Error('not implemented');
}

export function localDate(instantMs: number, tz: string): DateKey {
  return notImplemented(instantMs, tz);
}

export function localTime(instantMs: number, tz: string): string {
  return notImplemented(instantMs, tz);
}

export function slotInstant(date: DateKey, time: string, tz: string): number {
  return notImplemented(date, time, tz);
}

export function startOfLocalDay(date: DateKey, tz: string): number {
  return notImplemented(date, tz);
}
