import { localDate, localTime, occurrences, slotInstant } from '@pawlaris/shared';
import recurrence from '../../../../../../spec/fixtures/recurrence-vectors.json';
import time from '../../../../../../spec/fixtures/time-vectors.json';
import { runSelfTest, type SelfTestEngine } from '../selfTest';

const engine: SelfTestEngine = { occurrences, localDate, localTime, slotInstant };
const total = recurrence.vectors.length + time.localDate.length + time.localTime.length + time.slotInstant.length;

test('RC-3 RC-1 TZ-1 the self-test runs every bundled recurrence and time vector', () => {
  expect(runSelfTest()).toEqual({ passed: total, total, failures: [] });
});

test.each([
  { name: 'occurrences', overrides: { occurrences: () => [] },
    failures: recurrence.vectors.filter((vector) => vector.expect.length > 0).map((vector) => vector.name) },
  { name: 'localDate', overrides: { localDate: () => 'wrong-date' },
    failures: time.localDate.map((vector) => vector.name) },
  { name: 'localTime', overrides: { localTime: () => 'wrong-time' },
    failures: time.localTime.map((vector) => vector.name) },
  { name: 'slotInstant', overrides: { slotInstant: () => Number.NaN },
    failures: time.slotInstant.map((vector) => vector.name) },
])('RC-3 a wrong $name engine names the failing vectors and keeps running the others', ({ overrides, failures }) => {
  const result = runSelfTest({ ...engine, ...overrides });
  expect(result.total).toBe(total);
  expect(result.passed).toBe(total - failures.length);
  expect(result.failures).toHaveLength(failures.length);
  expect(result.failures).toEqual(expect.arrayContaining(failures));
});

test('RC-3 an engine exception names each affected vector and still runs the time vectors', () => {
  const result = runSelfTest({ ...engine, occurrences: () => { throw new Error('Test engine failure'); } });
  expect(result).toEqual({
    total, passed: total - recurrence.vectors.length, failures: recurrence.vectors.map((vector) => vector.name),
  });
});
