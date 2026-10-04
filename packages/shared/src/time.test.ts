import { describe, expect, it, vi } from 'vitest';
import vectors from '../../../spec/fixtures/time-vectors.json';
import { addDays, daysBetween, mondayOf, weekdayOf } from './dates';
import { localDate, localTime, slotInstant, startOfLocalDay } from './time';

describe('TZ-1 golden timezone vectors', () => {
  it.each(vectors.localDate)('TZ-1 localDate: $name', ({ instant, tz, expect: expected }) => {
    expect(localDate(Date.parse(instant), tz)).toBe(expected);
  });

  it.each(vectors.localTime)('TZ-1 localTime: $name', ({ instant, tz, expect: expected }) => {
    expect(localTime(Date.parse(instant), tz)).toBe(expected);
  });

  it.each(vectors.slotInstant)('TZ-1 slotInstant: $name', ({ date, time, tz, expect: expected }) => {
    expect(slotInstant(date, time, tz)).toBe(Date.parse(expected));
  });

  it.each(vectors.slotInstant.filter(({ time }) => time === '00:00'))(
    'TZ-1 startOfLocalDay: $name', ({ date, tz, expect: expected }) => {
      expect(startOfLocalDay(date, tz)).toBe(Date.parse(expected));
    },
  );

  it.each([
    ['2026-03-08', 23], ['2026-11-01', 25], ['2026-10-03', 24],
  ] as const)('TZ-1 local day %s spans %i hours in New York', (date, hours) => {
    const start = startOfLocalDay(date, 'America/New_York');
    expect(startOfLocalDay(addDays(date, 1), 'America/New_York') - start).toBe(hours * 3_600_000);
    expect(localDate(start, 'America/New_York')).toBe(date);
    expect(localTime(start, 'America/New_York')).toBe('00:00');
  });

  it('TZ-1 resolves fractional-hour offsets in both directions', () => {
    const instant = Date.parse('2026-10-03T18:15:00Z');
    expect(localDate(instant, 'Asia/Kathmandu')).toBe('2026-10-04');
    expect(localTime(instant, 'Asia/Kathmandu')).toBe('00:00');
    expect(slotInstant('2026-10-04', '00:00', 'Asia/Kathmandu')).toBe(instant);
  });

  it.each(['0001-01-01', '0096-02-29'])(
    'TZ-1 UTC conversions preserve the four-digit year in %s', (date) => {
      const instant = Date.parse(`${date}T12:30:00Z`);
      expect(localDate(instant, 'UTC')).toBe(date);
      expect(localTime(instant, 'UTC')).toBe('12:30');
      expect(slotInstant(date, '12:30', 'UTC')).toBe(instant);
      expect(startOfLocalDay(date, 'UTC')).toBe(Date.parse(`${date}T00:00:00Z`));
    },
  );

  it('TZ-1 a valid local date can resolve past the UTC four-digit year boundary', () => {
    const instant = Date.parse('+010000-01-01T04:59:00Z');
    expect(slotInstant('9999-12-31', '23:59', 'America/New_York')).toBe(instant);
    expect(localDate(instant, 'America/New_York')).toBe('9999-12-31');
    expect(localTime(instant, 'America/New_York')).toBe('23:59');
  });

  it('TZ-1 reuses one explicit-zone formatter across functions and instants', () => {
    const formatter = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      const instant = Date.parse('2026-01-01T00:00:00Z');
      expect(localDate(instant, 'Pacific/Chatham')).toBe('2026-01-01');
      expect(localTime(instant, 'Pacific/Chatham')).toBe('13:45');
      expect(localTime(instant + 60_000, 'Pacific/Chatham')).toBe('13:46');
      expect(formatter).toHaveBeenCalledTimes(1);
      expect(formatter).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        timeZone: 'Pacific/Chatham',
      }));
    } finally {
      formatter.mockRestore();
    }
  });

  it('RC-2 calendar and timezone functions ignore three mocked system times', () => {
    vi.useFakeTimers();
    try {
      const results = [0, Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1)].map((now) => {
        vi.setSystemTime(now);
        const instant = Date.parse('2026-11-01T05:30:00Z');
        return {
          date: addDays('2028-02-28', 1),
          days: daysBetween('2026-12-31', '2027-01-01'),
          weekday: weekdayOf('2026-09-14'),
          monday: mondayOf('2026-09-20'),
          localDate: localDate(instant, 'America/New_York'),
          localTime: localTime(instant, 'America/New_York'),
          slot: slotInstant('2026-11-01', '01:30', 'America/New_York'),
          start: startOfLocalDay('2026-11-01', 'America/New_York'),
        };
      });
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
