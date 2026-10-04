export type DateKey = string;
export type CalendarDate = { y: number; m: number; d: number };

const DAY_MS = 86_400_000;

// Q-6: real Gregorian dates, years 0001–9999, months 1–12; reject invalid inputs.
function validYearMonth(y: number, m: number): boolean {
  return Number.isInteger(y) && y >= 1 && y <= 9999
    && Number.isInteger(m) && m >= 1 && m <= 12;
}

export function utcDate({ y, m, d }: CalendarDate): number {
  // Date.UTC maps years 0–99 to 1900–1999. A Gregorian 400-year cycle
  // has exactly 146097 days, so shifting by one cycle preserves leap days.
  return y < 100
    ? Date.UTC(y + 400, m - 1, d) - 146097 * DAY_MS
    : Date.UTC(y, m - 1, d);
}

export function isDateKey(key: string): boolean {
  if (key.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  return validYearMonth(y, m) && d >= 1 && d <= daysInMonth(y, m);
}

export function parseDateKey(key: DateKey): CalendarDate {
  if (!isDateKey(key)) throw new RangeError('Invalid calendar date key.');
  return {
    y: Number(key.slice(0, 4)),
    m: Number(key.slice(5, 7)),
    d: Number(key.slice(8, 10)),
  };
}

export function formatDateKey({ y, m, d }: CalendarDate): DateKey {
  if (![y, m, d].every(Number.isInteger)) {
    throw new RangeError('Calendar date components must be integers.');
  }
  const key = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isDateKey(key)) throw new RangeError('Invalid calendar date.');
  return key;
}

export function addDays(key: DateKey, n: number): DateKey {
  if (!Number.isInteger(n)) throw new RangeError('Day offset must be an integer.');
  const date = new Date(utcDate(parseDateKey(key)) + n * DAY_MS);
  return formatDateKey({
    y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(),
  });
}

export function daysBetween(a: DateKey, b: DateKey): number {
  return (utcDate(parseDateKey(b)) - utcDate(parseDateKey(a))) / DAY_MS;
}

export function weekdayOf(key: DateKey): number {
  return (new Date(utcDate(parseDateKey(key))).getUTCDay() + 6) % 7;
}

export function mondayOf(key: DateKey): DateKey {
  return addDays(key, -weekdayOf(key));
}

export function daysInMonth(y: number, m: number): number {
  if (!validYearMonth(y, m)) throw new RangeError('Invalid calendar year or month.');
  return new Date(utcDate({ y, m: m + 1, d: 0 })).getUTCDate();
}

export function monthsBetween(a: DateKey, b: DateKey): number {
  const start = parseDateKey(a);
  const end = parseDateKey(b);
  return (end.y - start.y) * 12 + end.m - start.m;
}

export function compareDateKey(a: DateKey, b: DateKey): number {
  parseDateKey(a);
  parseDateKey(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
