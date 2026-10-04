import { describe, expect, it } from 'vitest';
import {
  addDays, compareDateKey, daysBetween, daysInMonth, formatDateKey,
  isDateKey, mondayOf, monthsBetween, parseDateKey, weekdayOf,
} from './dates';

describe('RC-2 calendar dates', () => {
  it.each([
    ['2028-02-29', { y: 2028, m: 2, d: 29 }],
    ['2100-02-28', { y: 2100, m: 2, d: 28 }],
    ['2000-02-29', { y: 2000, m: 2, d: 29 }],
    ['0001-01-01', { y: 1, m: 1, d: 1 }],
    ['0096-02-29', { y: 96, m: 2, d: 29 }],
    ['9999-12-31', { y: 9999, m: 12, d: 31 }],
  ] as const)('RC-2 parses and formats the real calendar date %s', (key, date) => {
    expect(isDateKey(key)).toBe(true);
    expect(parseDateKey(key)).toEqual(date);
    expect(formatDateKey(date)).toBe(key);
  });

  it.each([
    '', '2026-2-01', '2026-02-1', '26-02-01', '10000-01-01',
    '0000-01-01', '2026-00-01', '2026-13-01', '2026-01-00',
    '2026-01-32', '2026-04-31', '2026-02-29', '2100-02-29',
    '2028-02-30', '2026-01-01T00:00:00Z', '2026-01-01\n',
  ])('RC-2 rejects the invalid date key %j without normalizing it', (key) => {
    expect(isDateKey(key)).toBe(false);
    expect(() => parseDateKey(key)).toThrow(RangeError);
  });

  it.each([
    [2028, 2, 29], [2100, 2, 28], [2000, 2, 29], [1900, 2, 28],
    [2026, 4, 30], [2026, 12, 31], [96, 2, 29],
  ] as const)('RC-2 daysInMonth(%i, %i) is %i', (y, m, length) => {
    expect(daysInMonth(y, m)).toBe(length);
  });

  it.each([
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-29', 1, '2028-03-01'],
    ['2100-02-28', 1, '2100-03-01'],
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2028-03-01', -2, '2028-02-28'],
    ['2026-09-14', 0, '2026-09-14'],
    ['0099-12-31', 1, '0100-01-01'],
    ['0001-01-01', 1, '0001-01-02'],
  ] as const)('RC-2 addDays(%s, %i) is %s', (key, n, expected) => {
    expect(addDays(key, n)).toBe(expected);
    expect(daysBetween(key, expected)).toBe(n);
    expect(daysBetween(expected, key)).toBe(-n || 0);
  });

  it.each([
    ['2026-09-14', 0, '2026-09-14'],
    ['2026-09-15', 1, '2026-09-14'],
    ['2026-09-20', 6, '2026-09-14'],
    ['2027-01-01', 4, '2026-12-28'],
  ] as const)('RC-2 weekday and Monday of %s are host-independent', (key, weekday, monday) => {
    expect(weekdayOf(key)).toBe(weekday);
    expect(mondayOf(key)).toBe(monday);
  });

  it.each([
    ['2026-01-31', '2026-02-01', 1],
    ['2026-01-01', '2026-01-31', 0],
    ['2026-12-31', '2027-01-01', 1],
    ['2028-03-01', '2026-12-31', -15],
  ] as const)('RC-2 monthsBetween(%s, %s) ignores the day', (a, b, expected) => {
    expect(monthsBetween(a, b)).toBe(expected);
  });

  it('RC-2 compares date keys in calendar order', () => {
    expect(compareDateKey('2026-12-31', '2027-01-01')).toBeLessThan(0);
    expect(compareDateKey('2027-01-01', '2026-12-31')).toBeGreaterThan(0);
    expect(compareDateKey('2026-12-31', '2026-12-31')).toBe(0);
  });

  it.each([
    { y: 0, m: 1, d: 1 }, { y: 10000, m: 1, d: 1 },
    { y: 2026, m: 1.5, d: 1 }, { y: 2026, m: 1, d: 1.5 },
    { y: 2026.5, m: 1, d: 1 }, { y: NaN, m: 1, d: 1 },
    { y: 2026, m: 13, d: 1 }, { y: 2100, m: 2, d: 29 },
  ])('RC-2 rejects invalid calendar components %j', (date) => {
    expect(() => formatDateKey(date)).toThrow(RangeError);
  });

  it.each([[0, 1], [10000, 1], [2026, 0], [2026, 13], [2026, 1.5], [2026.5, 1]])(
    'RC-2 rejects an invalid year or month (%i, %i)', (y, m) => {
      expect(() => daysInMonth(y, m)).toThrow(RangeError);
    },
  );

  it.each([0.5, NaN, Infinity])('RC-2 rejects a non-integer day offset %s', (offset) => {
    expect(() => addDays('2026-01-01', offset)).toThrow(RangeError);
  });

  it.each([['0001-01-01', -1], ['9999-12-31', 1], ['2026-01-01', 1e20]] as const)(
    'RC-2 rejects an addition outside the date-key range (%s, %s)', (key, offset) => {
      expect(() => addDays(key, offset)).toThrow(RangeError);
    },
  );
});
