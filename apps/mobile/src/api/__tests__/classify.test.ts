import type { ApiResult } from '../client';
import { classify } from '../errors';

function result(status: number): ApiResult {
  const fields = { status, body: null, headers: {} };
  return status >= 200 && status < 300 ? { ...fields, ok: true } : { ...fields, ok: false };
}

test.each([200, 201, 204, 299])('CLASS-2XX: %i is ok', (status) => {
  expect(classify(result(status))).toBe('ok');
});

test('CLASS-NETWORK: a fetch failure is transient without a retry limit', () => {
  expect(classify({ networkError: true }, { serverErrors: 100 })).toBe('transient');
});

test('CLASS-TIMEOUT: a 15-second timeout is transient without a retry limit', () => {
  expect(classify({ networkError: true }, { serverErrors: 7 })).toBe('transient');
});

test.each([408, 425, 429])('CLASS-RETRY: %i is transient', (status) => {
  expect(classify(result(status), { serverErrors: 7 })).toBe('transient');
});

test.each([0, 1, 2, 3, 4, 5, 6])(
  'CLASS-5XX: 500 after %i previous server errors is transient', (serverErrors) => {
    expect(classify(result(500), { serverErrors })).toBe('transient');
  },
);

test.each([500, 502, 503, 599])('CLASS-EIGHTH-5XX: the eighth %i is permanent', (status) => {
  expect(classify(result(status), { serverErrors: 7 })).toBe('permanent');
});

test('CLASS-5XX-NO-ENTRY: a 503 without an outbox entry is transient', () => {
  expect(classify(result(503))).toBe('transient');
});

test('CLASS-5XX-COUNTER: attempts do not count toward the server error limit', () => {
  const entry = { serverErrors: 6, attempts: 100 };
  expect(classify(result(500), entry)).toBe('transient');
});

test('CLASS-AUTH: a 401 after one refresh and retry is auth', () => {
  expect(classify(result(401))).toBe('auth');
});

test.each([400, 403, 404, 405, 409, 410, 413, 422])(
  'CLASS-4XX: %i is permanent', (status) => {
    expect(classify(result(status))).toBe('permanent');
  },
);

test.each([302, 101])('CLASS-OTHER: %i is permanent without throwing', (status) => {
  expect(classify(result(status))).toBe('permanent');
});
