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
    if (!rule.ok) throw new Error(JSON.stringify(rule.errors));
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

  const rejected: { name: string; value: unknown; field: string; code: string }[] = [
    ...[null, false, 1, 'daily', []].map((value) => ({
      name: `invalid shape ${String(value)}`, value, field: 'freq', code: 'invalid',
    })),
    { name: 'missing rule', value: undefined, field: 'freq', code: 'required' },
    { name: 'missing frequency', value: {}, field: 'freq', code: 'required' },
    { name: 'null frequency', value: { freq: null }, field: 'freq', code: 'invalid' },
    { name: 'unknown frequency', value: { freq: 'yearly', interval: 1 }, field: 'freq', code: 'invalid' },
    ...['daily', 'weekly', 'monthly'].flatMap((freq) => {
      const fields = freq === 'weekly' ? { byday: ['MO'] }
        : freq === 'monthly' ? { bymonthday: [1] } : {};
      return [
        { interval: undefined, code: 'required' }, { interval: null, code: 'invalid' },
        { interval: 0, code: 'out_of_range' }, { interval: 366, code: 'out_of_range' },
        { interval: -1, code: 'out_of_range' }, { interval: 1.5, code: 'invalid' },
        { interval: '1', code: 'invalid' }, { interval: NaN, code: 'invalid' },
        { interval: Infinity, code: 'invalid' },
      ].map(({ interval, code }) => ({
        name: `${freq} invalid interval ${String(interval)}`, value: { freq, interval, ...fields },
        field: 'interval', code,
      }));
    }),
    ...[
      { byday: undefined, code: 'required' }, { byday: null, code: 'invalid' },
      { byday: [], code: 'required' }, { byday: ['MO', 'MO'], code: 'duplicate' },
      { byday: ['XX'], code: 'invalid' }, { byday: ['mo'], code: 'invalid' },
      { byday: [1], code: 'invalid' }, { byday: 'MO', code: 'invalid' },
    ].map(({ byday, code }) => ({
      name: `invalid byday ${String(byday)}`, value: { freq: 'weekly', interval: 1, byday }, field: 'byday', code,
    })),
    ...[
      { bymonthday: undefined, code: 'required' }, { bymonthday: null, code: 'invalid' },
      { bymonthday: [], code: 'required' }, { bymonthday: [0], code: 'out_of_range' },
      { bymonthday: [32], code: 'out_of_range' }, { bymonthday: [1.5], code: 'invalid' },
      { bymonthday: ['1'], code: 'invalid' }, { bymonthday: [1, 1], code: 'duplicate' },
      { bymonthday: '1', code: 'invalid' },
    ].map(({ bymonthday, code }) => ({
      name: `invalid bymonthday ${String(bymonthday)}`, value: { freq: 'monthly', interval: 1, bymonthday },
      field: 'bymonthday', code,
    })),
    { name: 'unknown key', value: { freq: 'daily', interval: 1, extra: true }, field: 'extra', code: 'unknown_key' },
    { name: 'weekly date is unknown', value: { freq: 'weekly', interval: 1, byday: ['MO'], date: startsOn }, field: 'date', code: 'unknown_key' },
    { name: 'monthly byday is unknown', value: { freq: 'monthly', interval: 1, bymonthday: [1], byday: ['MO'] }, field: 'byday', code: 'unknown_key' },
    { name: 'once without date', value: { freq: 'once' }, field: 'date', code: 'required' },
    { name: 'once date is not a string', value: { freq: 'once', date: 20260914 }, field: 'date', code: 'invalid' },
    { name: 'once date does not equal startsOn', value: { freq: 'once', date: '2026-09-15' }, field: 'date', code: 'mismatch' },
    { name: 'once date is nonexistent', value: { freq: 'once', date: '2026-02-30' }, field: 'date', code: 'invalid' },
    { name: 'once interval is forbidden', value: { freq: 'once', date: startsOn, interval: 1 }, field: 'interval', code: 'unknown_key' },
  ];
  it.each(rejected)('R3.13 rejects $name', ({ value, field, code }) => {
    expect(validateRecurrence(value, startsOn)).toEqual({ ok: false, errors: [{ field, code }] });
  });

  it.each(['2026-02-30', '0000-01-01', '2026-9-14'])(
    'R3.13 rejects invalid startsOn %s', (date) => {
      expect(validateRecurrence({ freq: 'daily', interval: 1 }, date)).toEqual({
        ok: false, errors: [{ field: 'starts_on', code: 'invalid' }],
      });
    },
  );
  it('R3.13 accepts a once rule on a real leap day', () => {
    const rule = { freq: 'once', date: '2028-02-29' };
    expect(validateRecurrence(rule, rule.date)).toEqual({ ok: true, value: rule });
  });
  it.each([
    { value: null, errors: [{ field: 'starts_on', code: 'invalid' }, { field: 'freq', code: 'invalid' }] },
    { value: { freq: 'yearly' }, errors: [{ field: 'starts_on', code: 'invalid' }, { field: 'freq', code: 'invalid' }] },
    { value: { freq: 'once', date: startsOn }, errors: [{ field: 'starts_on', code: 'invalid' }] },
    { value: { freq: 'once' }, errors: [{ field: 'starts_on', code: 'invalid' }, { field: 'date', code: 'required' }] },
  ])('R3.13 reports independent errors with an invalid start $value', ({ value, errors }) => {
    expect(validateRecurrence(value, '2026-02-30')).toEqual({ ok: false, errors });
  });
  it('R3.13 reports every unknown key alongside interval and weekday problems', () => {
    expect(validateRecurrence({
      freq: 'weekly', interval: 0, byday: ['XX', 'XX'], extra: true, other: true,
    }, startsOn)).toEqual({ ok: false, errors: [
      { field: 'extra', code: 'unknown_key' }, { field: 'other', code: 'unknown_key' },
      { field: 'interval', code: 'out_of_range' }, { field: 'byday', code: 'invalid' },
      { field: 'byday', code: 'duplicate' },
    ] });
  });
  it('R3.13 reports a once mismatch alongside an unknown key', () => {
    expect(validateRecurrence({ freq: 'once', date: '2026-09-15', extra: true }, startsOn)).toEqual({
      ok: false, errors: [{ field: 'extra', code: 'unknown_key' }, { field: 'date', code: 'mismatch' }],
    });
  });
  it('R3.13 reports too many weekdays and a duplicate', () => {
    expect(validateRecurrence({
      freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU', 'MO'],
    }, startsOn)).toEqual({ ok: false, errors: [
      { field: 'byday', code: 'too_many' }, { field: 'byday', code: 'duplicate' },
    ] });
  });
  it('R3.13 reports too many month days and a duplicate', () => {
    expect(validateRecurrence({
      freq: 'monthly', interval: 1, bymonthday: [...Array.from({ length: 31 }, (_, i) => i + 1), 1],
    }, startsOn)).toEqual({ ok: false, errors: [
      { field: 'bymonthday', code: 'too_many' }, { field: 'bymonthday', code: 'duplicate' },
    ] });
  });
  it('R3.13 reports independent interval and month-day problems', () => {
    expect(validateRecurrence({
      freq: 'monthly', interval: null, bymonthday: ['1', 0, 0],
    }, startsOn)).toEqual({ ok: false, errors: [
      { field: 'interval', code: 'invalid' }, { field: 'bymonthday', code: 'invalid' },
      { field: 'bymonthday', code: 'out_of_range' }, { field: 'bymonthday', code: 'duplicate' },
    ] });
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
    { value: null, code: 'invalid' }, { value: undefined, code: 'required' },
    { value: '08:00', code: 'invalid' }, { value: {}, code: 'invalid' },
    { value: [800], code: 'invalid' }, { value: ['20:00', '08:00'], code: 'unsorted' },
    { value: ['08:00', '08:00'], code: 'duplicate' },
    ...['24:00', '8:00', '08:60', '08:00:30', '08:00\n', ' 08:00', ''].map((time) => ({ value: [time], code: 'invalid' })),
    { value: ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00'], code: 'too_many' },
  ])('R3.14 rejects invalid times $value', ({ value, code }) => {
    expect(validateTimesOfDay(value)).toEqual({ ok: false, errors: [{ field: 'times_of_day', code }] });
  });
  it('R3.14 reports duplicate times even when they are not adjacent or sorted', () => {
    expect(validateTimesOfDay(['08:00', '20:00', '08:00'])).toEqual({ ok: false, errors: [
      { field: 'times_of_day', code: 'duplicate' }, { field: 'times_of_day', code: 'unsorted' },
    ] });
  });
  it('R3.14 reports too many times alongside invalid and duplicate entries', () => {
    expect(validateTimesOfDay(['24:00', '24:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00'])).toEqual({
      ok: false, errors: [
        { field: 'times_of_day', code: 'too_many' }, { field: 'times_of_day', code: 'invalid' },
        { field: 'times_of_day', code: 'duplicate' },
      ],
    });
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
    '2026-09-14 08:00', '2026-09-14X08:00',
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
