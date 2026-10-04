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

type ValidationError = {
  field: string;
  code: 'required' | 'invalid' | 'out_of_range' | 'duplicate' | 'unsorted'
    | 'too_many' | 'mismatch' | 'unknown_key';
};
type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function isWeekday(value: unknown): value is Weekday {
  return WEEKDAYS.some((day) => day === value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && value.length === 5
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateRecurrence(value: unknown, startsOn: DateKey): ValidationResult<Recurrence> {
  const errors: ValidationError[] = [];
  if (!isDateKey(startsOn)) {
    errors.push({ field: 'starts_on', code: 'invalid' });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({ field: 'freq', code: value === undefined ? 'required' : 'invalid' });
    return { ok: false, errors };
  }
  const rule = value as Record<string, unknown>;
  const { freq } = rule;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'once') {
    errors.push({ field: 'freq', code: freq === undefined ? 'required' : 'invalid' });
    return { ok: false, errors };
  }
  const keys = freq === 'once' ? ['freq', 'date']
    : freq === 'weekly' ? ['freq', 'interval', 'byday']
      : freq === 'monthly' ? ['freq', 'interval', 'bymonthday'] : ['freq', 'interval'];
  for (const key of Object.keys(rule)) {
    if (!keys.includes(key)) errors.push({ field: key, code: 'unknown_key' });
  }
  if (freq === 'once') {
    const { date } = rule;
    if (date === undefined) errors.push({ field: 'date', code: 'required' });
    else if (typeof date !== 'string' || !isDateKey(date)) {
      errors.push({ field: 'date', code: 'invalid' });
    } else {
      if (isDateKey(startsOn) && date !== startsOn) errors.push({ field: 'date', code: 'mismatch' });
      if (errors.length === 0) return { ok: true, value: { freq, date } };
    }
    return { ok: false, errors };
  }
  const { interval } = rule;
  if (interval === undefined) errors.push({ field: 'interval', code: 'required' });
  else if (typeof interval !== 'number' || !Number.isInteger(interval)) {
    errors.push({ field: 'interval', code: 'invalid' });
  } else if (interval < 1 || interval > 365) {
    errors.push({ field: 'interval', code: 'out_of_range' });
  }
  if (freq === 'weekly') {
    const byday: unknown = rule.byday;
    if (byday === undefined) errors.push({ field: 'byday', code: 'required' });
    else if (!Array.isArray(byday)) errors.push({ field: 'byday', code: 'invalid' });
    else {
      if (byday.length === 0) errors.push({ field: 'byday', code: 'required' });
      if (byday.length > 7) errors.push({ field: 'byday', code: 'too_many' });
      if (!byday.every(isWeekday)) errors.push({ field: 'byday', code: 'invalid' });
      if (new Set(byday).size !== byday.length) errors.push({ field: 'byday', code: 'duplicate' });
      if (errors.length === 0 && typeof interval === 'number' && byday.every(isWeekday)) {
        return { ok: true, value: { freq, interval, byday: [...byday] } };
      }
    }
    return { ok: false, errors };
  }
  if (freq === 'monthly') {
    const bymonthday: unknown = rule.bymonthday;
    if (bymonthday === undefined) errors.push({ field: 'bymonthday', code: 'required' });
    else if (!Array.isArray(bymonthday)) errors.push({ field: 'bymonthday', code: 'invalid' });
    else {
      if (bymonthday.length === 0) errors.push({ field: 'bymonthday', code: 'required' });
      if (bymonthday.length > 31) errors.push({ field: 'bymonthday', code: 'too_many' });
      if (!bymonthday.every((day: unknown) => typeof day === 'number' && Number.isInteger(day))) {
        errors.push({ field: 'bymonthday', code: 'invalid' });
      }
      if (bymonthday.some((day: unknown) =>
        typeof day === 'number' && Number.isInteger(day) && (day < 1 || day > 31))) {
        errors.push({ field: 'bymonthday', code: 'out_of_range' });
      }
      if (new Set(bymonthday).size !== bymonthday.length) errors.push({ field: 'bymonthday', code: 'duplicate' });
      if (errors.length === 0 && typeof interval === 'number'
        && bymonthday.every((day: unknown): day is number => typeof day === 'number')) {
        return { ok: true, value: { freq, interval, bymonthday: [...bymonthday] } };
      }
    }
    return { ok: false, errors };
  }
  if (errors.length === 0 && typeof interval === 'number') return { ok: true, value: { freq, interval } };
  return { ok: false, errors };
}

export function validateTimesOfDay(value: unknown): ValidationResult<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, errors: [{ field: 'times_of_day', code: value === undefined ? 'required' : 'invalid' }] };
  }
  const errors: ValidationError[] = [];
  if (value.length > 8) errors.push({ field: 'times_of_day', code: 'too_many' });
  if (!value.every(isTime)) errors.push({ field: 'times_of_day', code: 'invalid' });
  if (new Set(value).size !== value.length) errors.push({ field: 'times_of_day', code: 'duplicate' });
  if (value.every(isTime)) {
    if (value.some((time, index) => {
      const previous = value[index - 1];
      return previous !== undefined && previous > time;
    })) errors.push({ field: 'times_of_day', code: 'unsorted' });
    if (errors.length === 0) return { ok: true, value: [...value] };
  }
  return { ok: false, errors };
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
