import * as Shared from '@pawlaris/shared';
import recurrence from '../../../../../spec/fixtures/recurrence-vectors.json';
import time from '../../../../../spec/fixtures/time-vectors.json';

export type SelfTestEngine = Pick<typeof Shared,
  'occurrences' | 'localDate' | 'localTime' | 'slotInstant'>;

export interface SelfTestResult {
  passed: number;
  total: number;
  failures: string[];
}

export function runSelfTest(engine: SelfTestEngine = Shared): SelfTestResult {
  const result: SelfTestResult = { passed: 0, total: 0, failures: [] };
  function check(name: string, actual: () => unknown, expected: unknown): void {
    result.total += 1;
    try {
      if (JSON.stringify(actual()) === JSON.stringify(expected)) {
        result.passed += 1;
        return;
      }
    } catch {
      // A broken vector must not prevent the remaining vectors from running.
    }
    result.failures.push(name);
  }
  for (const vector of recurrence.vectors) {
    check(vector.name, () => {
      const rule = Shared.validateRecurrence(vector.recurrence, vector.starts_on);
      if (!rule.ok) throw new Error('Invalid recurrence vector');
      return engine.occurrences({
        recurrence: rule.value, timesOfDay: vector.times_of_day,
        startsOn: vector.starts_on, endsOn: vector.ends_on, from: vector.from, to: vector.to,
      });
    }, vector.expect);
  }
  for (const vector of time.localDate) {
    check(vector.name, () => engine.localDate(Date.parse(vector.instant), vector.tz), vector.expect);
  }
  for (const vector of time.localTime) {
    check(vector.name, () => engine.localTime(Date.parse(vector.instant), vector.tz), vector.expect);
  }
  for (const vector of time.slotInstant) {
    check(vector.name, () => engine.slotInstant(vector.date, vector.time, vector.tz), Date.parse(vector.expect));
  }
  return result;
}
