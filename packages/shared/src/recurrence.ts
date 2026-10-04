import {
  addDays, daysBetween, isDateKey, mondayOf, monthsBetween, parseDateKey, weekdayOf,
  type DateKey,
} from './dates';

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

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function isWeekday(value: unknown): value is Weekday {
  return WEEKDAYS.some((day) => day === value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && value.length === 5
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateRecurrence(value: unknown, startsOn: DateKey): ValidationResult<Recurrence> {
  if (!isDateKey(startsOn)) {
    return { ok: false, errors: ['startsOn must be a real calendar date.'] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['Recurrence must be an object.'] };
  }
  const rule = value as Record<string, unknown>;
  const { freq } = rule;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'once') {
    return { ok: false, errors: ['Recurrence frequency is not supported.'] };
  }
  const keys = freq === 'once' ? ['freq', 'date']
    : freq === 'weekly' ? ['freq', 'interval', 'byday']
      : freq === 'monthly' ? ['freq', 'interval', 'bymonthday'] : ['freq', 'interval'];
  if (Object.keys(rule).some((key) => !keys.includes(key))) {
    return { ok: false, errors: ['Recurrence contains unknown keys.'] };
  }
  if (freq === 'once') {
    if (typeof rule.date !== 'string' || !isDateKey(rule.date) || rule.date !== startsOn) {
      return { ok: false, errors: ['Once date must be a real calendar date equal to startsOn.'] };
    }
    return { ok: true, value: { freq, date: rule.date } };
  }
  const { interval } = rule;
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > 365) {
    return { ok: false, errors: ['Interval must be an integer from 1 to 365.'] };
  }
  if (freq === 'weekly') {
    const byday: unknown = rule.byday;
    if (!Array.isArray(byday) || byday.length < 1 || byday.length > 7
      || !byday.every(isWeekday) || new Set(byday).size !== byday.length) {
      return { ok: false, errors: ['byday must contain 1 to 7 unique weekday codes.'] };
    }
    return { ok: true, value: { freq, interval, byday: [...byday] } };
  }
  if (freq === 'monthly') {
    const bymonthday: unknown = rule.bymonthday;
    if (!Array.isArray(bymonthday) || bymonthday.length < 1 || bymonthday.length > 31
      || !bymonthday.every((day: unknown): day is number =>
        typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31)
      || new Set(bymonthday).size !== bymonthday.length) {
      return { ok: false, errors: ['bymonthday must contain 1 to 31 unique integers from 1 to 31.'] };
    }
    return { ok: true, value: { freq, interval, bymonthday: [...bymonthday] } };
  }
  return { ok: true, value: { freq, interval } };
}

export function validateTimesOfDay(value: unknown): ValidationResult<string[]> {
  if (!Array.isArray(value) || value.length > 8 || !value.every(isTime)) {
    return { ok: false, errors: ['Times must contain 0 to 8 HH:mm entries from 00:00 to 23:59.'] };
  }
  if (value.some((time, index) => {
    const previous = value[index - 1];
    return previous !== undefined && previous >= time;
  })) {
    return { ok: false, errors: ['Times must be unique and sorted ascending.'] };
  }
  return { ok: true, value: [...value] };
}

export function occurrences(input: OccurrenceInput): string[] {
  const { recurrence, timesOfDay, startsOn, endsOn, from, to } = input;
  const lo = from > startsOn ? from : startsOn;
  const hi = endsOn !== null && endsOn < to ? endsOn : to;
  if (lo > hi) return [];
  if (daysBetween(from, to) > 400) {
    throw new RangeError('Occurrence range must not exceed 400 days.');
  }
  const result: string[] = [];
  const days = daysBetween(lo, hi);
  for (let i = 0; i <= days; i += 1) {
    const date = addDays(lo, i);
    let matches: boolean;
    switch (recurrence.freq) {
      case 'daily':
        matches = daysBetween(startsOn, date) % recurrence.interval === 0;
        break;
      case 'weekly':
        matches = recurrence.byday.some((day) => day === WEEKDAYS[weekdayOf(date)])
          && (daysBetween(mondayOf(startsOn), mondayOf(date)) / 7) % recurrence.interval === 0;
        break;
      case 'monthly':
        matches = recurrence.bymonthday.includes(parseDateKey(date).d)
          && monthsBetween(startsOn, date) % recurrence.interval === 0;
        break;
      case 'once':
        matches = date === recurrence.date;
        break;
    }
    if (matches) {
      if (timesOfDay.length === 0) result.push(date);
      else for (const time of timesOfDay) result.push(`${date}T${time}`);
    }
  }
  return result;
}

export function splitKey(key: string): { date: DateKey; time: string | null } {
  const date = key.slice(0, 10);
  if (!isDateKey(date)) throw new RangeError('Occurrence key must contain a real calendar date.');
  if (key.length === 10) return { date, time: null };
  const time = key.slice(11);
  if (key[10] !== 'T' || !isTime(time)) {
    throw new RangeError('Occurrence key must be YYYY-MM-DD or YYYY-MM-DDTHH:mm.');
  }
  return { date, time };
}
