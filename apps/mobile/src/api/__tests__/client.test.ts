import type { Session } from '../../auth/session';
import { response, servers, wireSession } from '../../auth/__tests__/support';
import type { Server } from '../../db/kv';
import { fakeClock } from '../../testing/fakeClock';
import { fakeHttp } from '../../testing/fakeHttp';
import { createApi, type ApiFailure } from '../client';

function clientContext() {
  let server: Server = 'primary';
  const http = fakeHttp();
  const accessToken = jest.fn(async (selected: Server = server): ReturnType<Session['accessToken']> => (
    wireSession(selected).access_token
  ));
  const refresh = jest.fn(async (selected: Server = server): ReturnType<Session['refresh']> => ({
    ok: true, ...response(200, wireSession(selected, 'rotated')),
    body: wireSession(selected, 'rotated'),
  }));
  const session = { accessToken, refresh };
  return {
    http, session,
    select(next: Server) { server = next; },
    makeApi: () => createApi({ http, session, servers, activeServer: () => server }),
  };
}

test.each<Server>(['primary', 'reserve'])(
  'API-ADDRESS / RS-9: use the active %s address and bearer token', async (server) => {
    const ctx = clientContext();
    ctx.select(server);
    ctx.http.enqueue(response(200, { id: 'fake-row' }));
    const api = ctx.makeApi();
    expect(await api.request('GET', '/pets')).toEqual({
      ok: true, ...response(200, { id: 'fake-row' }),
    });
    expect(ctx.http.requests).toEqual([{
      method: 'GET', url: `${servers[server]}/pets`, timeoutMs: 15_000,
      headers: expect.objectContaining({ Authorization: `Bearer fake-${server}-access-initial` }),
    }]);
    expect(ctx.session.accessToken).toHaveBeenCalledWith(server);
  },
);

test('API-SELECT / RS-9: the next request follows a changed active server', async () => {
  const ctx = clientContext();
  ctx.http.enqueue(response(200), response(200));
  const api = ctx.makeApi();
  await api.request('GET', '/sync');
  ctx.select('reserve');
  await api.request('GET', '/sync');
  expect(ctx.http.requests.map((req) => [req.url, req.headers?.Authorization])).toEqual([
    [`${servers.primary}/sync`, 'Bearer fake-primary-access-initial'],
    [`${servers.reserve}/sync`, 'Bearer fake-reserve-access-initial'],
  ]);
});

test.each([200, 201, 204, 299, 400, 422, 429, 503])(
  'API-MAP: preserve status, body and headers for %i', async (status) => {
    const ctx = clientContext();
    const body = status === 204 ? null : {
      type: 'about:blank', title: 'Test response', status,
      code: 'fake_test_code', detail: 'This is an obviously fake response.',
    };
    const headers = { 'retry-after': '12', 'server-timing': 'app;dur=1' };
    ctx.http.enqueue({ status, body, headers });
    expect(await ctx.makeApi().request('GET', '/sync')).toEqual({
      ok: status >= 200 && status < 300, status, body, headers,
    });
  },
);

test('API-RETRY / SE-1: refresh once and retry once with the same mutation', async () => {
  const ctx = clientContext();
  ctx.http.enqueue(response(401), response(201, { id: 'fake-pet' }));
  const body = { id: '00000000-0000-4000-8000-000000000003', name: 'Test pet', species: 'cat' };
  const headers = { 'Idempotency-Key': '00000000-0000-4000-8000-000000000004' };
  expect(await ctx.makeApi().request('POST', '/pets', body, headers)).toEqual({
    ok: true, ...response(201, { id: 'fake-pet' }),
  });
  expect(ctx.session.refresh).toHaveBeenCalledTimes(1);
  expect(ctx.session.refresh).toHaveBeenCalledWith('primary');
  expect(ctx.http.requests).toHaveLength(2);
  for (const req of ctx.http.requests) {
    expect(req).toMatchObject({ method: 'POST', url: `${servers.primary}/pets`, body, headers });
  }
  expect(ctx.http.requests.map((req) => req.headers?.Authorization)).toEqual([
    'Bearer fake-primary-access-initial', 'Bearer fake-primary-access-rotated',
  ]);
});

test('API-RETRY-LIMIT: a second 401 returns auth without a second refresh', async () => {
  const ctx = clientContext();
  ctx.http.enqueue(response(401), response(401, { code: 'token_invalid' }));
  expect(await ctx.makeApi().request('GET', '/me')).toEqual({
    ok: false, ...response(401, { code: 'token_invalid' }),
  });
  expect(ctx.session.refresh).toHaveBeenCalledTimes(1);
  expect(ctx.http.requests).toHaveLength(2);
});

test.each<ApiFailure>([
  { networkError: true },
  { ok: false, ...response(401, { code: 'token_invalid' }) },
  { ok: false, ...response(503) },
])('API-REFRESH-FAILURE: return a failed refresh without retrying (%j)', async (failure) => {
  const ctx = clientContext();
  ctx.session.refresh.mockResolvedValue(failure);
  ctx.http.enqueue(response(401));
  expect(await ctx.makeApi().request('GET', '/me')).toEqual(failure);
  expect(ctx.session.refresh).toHaveBeenCalledTimes(1);
  expect(ctx.http.requests).toHaveLength(1);
});

test('API-NETWORK: a thrown HTTP error maps to a network error', async () => {
  const ctx = clientContext();
  ctx.http.enqueue(new Error('Fake network is unreachable'));
  expect(await ctx.makeApi().request('GET', '/sync')).toEqual({ networkError: true });
  expect(ctx.session.refresh).not.toHaveBeenCalled();
});

test.each<ApiFailure>([
  { networkError: true },
  { ok: false, ...response(401, { code: 'token_invalid' }) },
])('API-ACCESS-FAILURE: return a failed token lookup without sending (%j)', async (failure) => {
  const ctx = clientContext();
  ctx.session.accessToken.mockResolvedValue(failure);
  expect(await ctx.makeApi().request('GET', '/sync')).toEqual(failure);
  expect(ctx.http.requests).toHaveLength(0);
  expect(ctx.session.refresh).not.toHaveBeenCalled();
});

test('API-RETRY-NETWORK: a thrown retry maps to a network error without refreshing again', async () => {
  const ctx = clientContext();
  ctx.http.enqueue(response(401), new Error('Fake retry network failure'));
  expect(await ctx.makeApi().request('GET', '/sync')).toEqual({ networkError: true });
  expect(ctx.session.refresh).toHaveBeenCalledTimes(1);
  expect(ctx.http.requests).toHaveLength(2);
});

test('API-TIMEOUT: a 15-second abort maps to a network error', async () => {
  const clock = fakeClock(0);
  const ctx = clientContext();
  ctx.http.enqueue((req) => {
    expect(req.timeoutMs).toBe(15_000);
    clock.advance(15_000);
    throw Object.assign(new Error('Fake request timed out'), { name: 'AbortError' });
  });
  expect(await ctx.makeApi().request('GET', '/sync')).toEqual({ networkError: true });
  expect(clock.now()).toBe(15_000);
  expect(ctx.session.refresh).not.toHaveBeenCalled();
});

test('API-SERVER-CAPTURE / RS-9: a retry stays on its original server after a move', async () => {
  const ctx = clientContext();
  ctx.http.enqueue(() => {
    ctx.select('reserve');
    return response(401);
  }, response(200));
  expect(await ctx.makeApi().request('GET', '/me')).toEqual({ ok: true, ...response(200) });
  expect(ctx.session.refresh).toHaveBeenCalledWith('primary');
  expect(ctx.http.requests.map((req) => [req.url, req.headers?.Authorization])).toEqual([
    [`${servers.primary}/me`, 'Bearer fake-primary-access-initial'],
    [`${servers.primary}/me`, 'Bearer fake-primary-access-rotated'],
  ]);
});

test('API-REDIRECT: a 302 maps to an unsuccessful result', async () => {
  const ctx = clientContext();
  const headers = { location: `${servers.primary}/me` };
  ctx.http.enqueue({ ...response(302), headers });
  expect(await ctx.makeApi().request('GET', '/sync')).toEqual({
    ok: false, ...response(302), headers,
  });
  expect(ctx.session.refresh).not.toHaveBeenCalled();
});
