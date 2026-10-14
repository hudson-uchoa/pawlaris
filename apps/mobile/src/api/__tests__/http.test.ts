import { fetchHttp } from '../../platform/http';
import { fakeClock } from '../../testing/fakeClock';
import { requestHttp } from '../client';

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['Date', 'performance'] }); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

const url = 'https://primary.pawlaris.invalid/api/v1/pets';

test('HTTP-JSON: serialize JSON and preserve response status, body and headers', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"fake-pet"}', {
    status: 201, headers: { 'Content-Type': 'application/json', 'Server-Timing': 'app;dur=1' },
  }));
  const body = { id: 'fake-pet' };
  expect(await fetchHttp.request({
    method: 'POST', url, body, headers: { Authorization: 'Bearer fake-primary-access' },
  })).toEqual({
    status: 201, body,
    headers: { 'content-type': 'application/json', 'server-timing': 'app;dur=1' },
  });
  expect(fetch).toHaveBeenCalledWith(url, {
    method: 'POST', body: JSON.stringify(body), signal: expect.objectContaining({ aborted: false }),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-primary-access' },
  });
  expect(jest.getTimerCount()).toBe(0);
});

test('HTTP-EMPTY: a bodyless 204 maps to null without a request body', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  expect(await fetchHttp.request({ method: 'DELETE', url })).toEqual({ status: 204, body: null, headers: {} });
  expect(fetch).toHaveBeenCalledWith(url, {
    method: 'DELETE', headers: {}, signal: expect.objectContaining({ aborted: false }),
  });
  expect(jest.getTimerCount()).toBe(0);
});

test('HTTP-TEXT: a non-JSON server error retains its HTTP status and text', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Fake upstream failure', { status: 502 }));
  expect(await requestHttp(fetchHttp, { method: 'GET', url })).toEqual({
    ok: false, status: 502, body: 'Fake upstream failure',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
  });
  expect(jest.getTimerCount()).toBe(0);
});

test('HTTP-FAILURE: a fetch failure maps to a network error and clears the timeout', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Fake network failure'));
  expect(await requestHttp(fetchHttp, { method: 'GET', url })).toEqual({ networkError: true });
  expect(jest.getTimerCount()).toBe(0);
});

test('HTTP-ABORT: abort at 15 seconds with a network result and no timer left', async () => {
  const clock = fakeClock(0);
  let signal: AbortSignal | null | undefined;
  jest.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
    signal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('Fake request aborted'), { name: 'AbortError' }));
      });
    });
  });
  const pending = requestHttp(fetchHttp, { method: 'GET', url });
  clock.advance(14_999);
  await jest.advanceTimersByTimeAsync(14_999);
  expect(signal?.aborted).toBe(false);
  clock.advance(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual({ networkError: true });
  expect(signal?.aborted).toBe(true);
  expect(clock.now()).toBe(15_000);
  expect(jest.getTimerCount()).toBe(0);
});
