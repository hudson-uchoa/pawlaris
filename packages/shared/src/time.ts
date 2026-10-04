import { formatDateKey, parseDateKey, type DateKey } from './dates';

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallParts(instantMs: number, tz: string) {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', era: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(tz, formatter);
  }
  const parts = Object.fromEntries<string>(
    formatter.formatToParts(instantMs).map(({ type, value }) => [type, value]),
  );
  return {
    y: parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year),
    m: Number(parts.month), d: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function offset(instantMs: number, tz: string): number {
  const { y, m, d, hour, minute, second } = wallParts(instantMs, tz);
  // Offset probes may cross year 0000 or 10000 at the date-key boundaries.
  const wallUtc = y < 100
    ? Date.UTC(y + 400, m - 1, d, hour, minute, second) - 146097 * DAY_MS
    : Date.UTC(y, m - 1, d, hour, minute, second);
  return wallUtc - instantMs;
}

export function localDate(instantMs: number, tz: string): DateKey {
  return formatDateKey(wallParts(instantMs, tz));
}

export function localTime(instantMs: number, tz: string): string {
  const { hour, minute } = wallParts(instantMs, tz);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function slotInstant(date: DateKey, time: string, tz: string): number {
  parseDateKey(date);
  // An explicit UTC string preserves four-digit years below 0100.
  const g = Date.parse(`${date}T${time}:00Z`);
  const o1 = offset(g - DAY_MS, tz);
  const c1 = g - o1;
  const o2 = offset(c1, tz);
  if (o2 === o1) return c1;
  const c2 = g - o2;
  if (offset(c2, tz) === o2) return c2;
  return c1;
}

export function startOfLocalDay(date: DateKey, tz: string): number {
  return slotInstant(date, '00:00', tz);
}
