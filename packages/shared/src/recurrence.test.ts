import { describe, expect, it, vi } from 'vitest';
import vectors from '../../../spec/fixtures/recurrence-vectors.json';
import { addDays } from './dates';
import {
  occurrences, splitKey, validateRecurrence, validateTimesOfDay,
  type OccurrenceInput, type Recurrence,
} from './recurrence';

const startsOn = '2026-09-14';
const dailyInput: OccurrenceInput = {
  recurrence: { freq: 'daily', interval: 1 }, timesOfDay: [],
  startsOn, endsOn: null, from: startsOn, to: '2026-09-16',
};

describe('RC-1 golden recurrence vectors', () => {
  it.each(vectors.vectors)('RC-1 $name', (vector) => {
    const rule = validateRecurrence(vector.recurrence, vector.starts_on);
    if (!rule.ok) throw new Error(rule.errors.join('; '));
    expect(occurrences({
      recurrence: rule.value, timesOfDay: vector.times_of_day,
      startsOn: vector.starts_on, endsOn: vector.ends_on,
      from: vector.from, to: vector.to,
    })).toEqual(vector.expect);
  });
});

describe('R3.13 recurrence validation', () => {
  const accepted: Recurrence[] = [
    { freq: 'daily', interval: 1 }, { freq: 'daily', interval: 365 },
    { freq: 'weekly', interval: 2, byday: ['FR', 'MO'] },
    { freq: 'weekly', interval: 365, byday: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] },
    { freq: 'monthly', interval: 1, bymonthday: [31, 1] },
    { freq: 'monthly', interval: 365, bymonthday: Array.from({ length: 31 }, (_, i) => i + 1) },
    { freq: 'once', date: startsOn },
  ];
  it.each(accepted)('R3.13 accepts %j without reordering', (rule) => {
    expect(validateRecurrence(rule, startsOn)).toEqual({ ok: true, value: rule });
  });

  const rejected: { name: string; value: unknown }[] = [
    ...[null, undefined, false, 1, 'daily', [], {}].map((value) => ({ name: `invalid shape ${String(value)}`, value })),
    { name: 'unknown frequency', value: { freq: 'yearly', interval: 1 } },
    ...['daily', 'weekly', 'monthly'].flatMap((freq) => {
      const fields = freq === 'weekly' ? { byday: ['MO'] }
        : freq === 'monthly' ? { bymonthday: [1] } : {};
      return [undefined, null, 0, 366, -1, 1.5, '1', NaN, Infinity].map((interval) => ({
        name: `${freq} invalid interval ${String(interval)}`, value: { freq, interval, ...fields },
      }));
    }),
    ...[undefined, null, [], ['MO', 'MO'], ['XX'], ['mo'], [1], 'MO'].map((byday) => ({
      name: `invalid byday ${String(byday)}`, value: { freq: 'weekly', interval: 1, byday },
    })),
    ...[undefined, null, [], [0], [32], [1.5], ['1'], [1, 1], '1'].map((bymonthday) => ({
      name: `invalid bymonthday ${String(bymonthday)}`, value: { freq: 'monthly', interval: 1, bymonthday },
    })),
    { name: 'unknown key', value: { freq: 'daily', interval: 1, extra: true } },
    { name: 'weekly date is unknown', value: { freq: 'weekly', interval: 1, byday: ['MO'], date: startsOn } },
    { name: 'monthly byday is unknown', value: { freq: 'monthly', interval: 1, bymonthday: [1], byday: ['MO'] } },
    { name: 'once without date', value: { freq: 'once' } },
    { name: 'once date is not a string', value: { freq: 'once', date: 20260914 } },
    { name: 'once date does not equal startsOn', value: { freq: 'once', date: '2026-09-15' } },
    { name: 'once date is nonexistent', value: { freq: 'once', date: '2026-02-30' } },
    { name: 'once interval is forbidden', value: { freq: 'once', date: startsOn, interval: 1 } },
  ];
  it.each(rejected)('R3.13 rejects $name', ({ value }) => {
    const result = validateRecurrence(value, startsOn);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((error) => typeof error === 'string' && error.length > 0)).toBe(true);
    }
  });

  it.each(['2026-02-30', '0000-01-01', '2026-9-14'])(
    'R3.13 rejects invalid startsOn %s', (date) => {
      expect(validateRecurrence({ freq: 'daily', interval: 1 }, date).ok).toBe(false);
    },
  );
  it('R3.13 accepts a once rule on a real leap day', () => {
    const rule = { freq: 'once', date: '2028-02-29' };
    expect(validateRecurrence(rule, rule.date)).toEqual({ ok: true, value: rule });
  });
});

describe('R3.14 times and occurrence keys', () => {
  it.each([[], ['08:00'], ['00:00', '23:59'],
    ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']]
    .map((times) => ({ times })))(
    'R3.14 accepts sorted unique times $times', ({ times }) => {
      expect(validateTimesOfDay(times)).toEqual({ ok: true, value: times });
    },
  );
  it.each([
    { value: null }, { value: undefined }, { value: '08:00' }, { value: {} },
    { value: [800] }, { value: ['20:00', '08:00'] }, { value: ['08:00', '08:00'] },
    ...['24:00', '8:00', '08:60', '08:00:30', '08:00\n', ' 08:00', ''].map((time) => ({ value: [time] })),
    { value: ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00'] },
  ])('R3.14 rejects invalid times $value', ({ value }) => {
    const result = validateTimesOfDay(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it.each([
    { key: '2026-09-14', date: '2026-09-14', time: null },
    { key: '2026-09-14T08:00', date: '2026-09-14', time: '08:00' },
    { key: '2028-02-29T00:00', date: '2028-02-29', time: '00:00' },
    { key: '9999-12-31T23:59', date: '9999-12-31', time: '23:59' },
  ])('R3.14 splits $key', ({ key, date, time }) => {
    expect(splitKey(key)).toEqual({ date, time });
  });
  it.each(['', '2026-02-30', '2026-9-14', '0000-01-01', '2026-09-14T',
    '2026-09-14T24:00', '2026-09-14T8:00', '2026-09-14T08:60',
    '2026-09-14T08:00:30', '2026-09-14T08:00Z', '2026-09-14T08:00\n',
    '2026-09-14T08:00T09:00'])(
    'R3.14 rejects malformed key %j', (key) => {
      expect(() => splitKey(key)).toThrow(RangeError);
    },
  );
});

describe('RC-1 range bounds and RC-2 purity', () => {
  it('RC-1 permits a 400-day difference, including both endpoints', () => {
    const to = addDays(startsOn, 400);
    const result = occurrences({ ...dailyInput, to });
    expect(result).toHaveLength(401);
    expect(result[0]).toBe(startsOn);
    expect(result[400]).toBe(to);
  });
  it.each([401, 800])('RC-1 throws RangeError over 400 days (%i)', (days) => {
    expect(() => occurrences({ ...dailyInput, to: addDays(startsOn, days) })).toThrow(RangeError);
  });
  it('RC-1 measures the requested range before clipping a nonempty result', () => {
    expect(() => occurrences({
      ...dailyInput, endsOn: startsOn, to: addDays(startsOn, 401),
    })).toThrow(RangeError);
  });
  it('RC-1 returns an empty effective range before applying the size guard', () => {
    expect(occurrences({
      ...dailyInput, endsOn: '2026-09-13', to: addDays(startsOn, 401),
    })).toEqual([]);
  });
  it.each(['0001-01-01', '9999-12-31'])(
    'RC-1 includes the date-key boundary %s without stepping outside it', (date) => {
      expect(occurrences({ ...dailyInput, startsOn: date, from: date, to: date })).toEqual([date]);
    },
  );
  it('RC-2 returns the same arrays under three mocked system times', () => {
    const input: OccurrenceInput = {
      ...dailyInput, recurrence: { freq: 'weekly', interval: 2, byday: ['MO', 'FR'] },
      timesOfDay: ['08:00', '20:00'], to: '2026-10-04',
    };
    const original = structuredClone(input);
    vi.useFakeTimers();
    try {
      const results = [0, Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1)].map((now) => {
        vi.setSystemTime(now);
        return occurrences(input);
      });
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
      expect(results[0]).toEqual([
        '2026-09-14T08:00', '2026-09-14T20:00', '2026-09-18T08:00', '2026-09-18T20:00',
        '2026-09-28T08:00', '2026-09-28T20:00', '2026-10-02T08:00', '2026-10-02T20:00',
      ]);
      expect(input).toEqual(original);
    } finally {
      vi.useRealTimers();
    }
  });
});
