import { createApi, requestHttp } from '../../api/client';
import { response, servers, wireSession } from '../../auth/__tests__/support';
import type { Servers } from '../../config/servers';
import { serverKey, type Server } from '../../db/kv';
import type { HttpReply } from '../../testing/fakeHttp';
import { createPull, type PullResult } from '../pull';
import { createServerSelect, type ServerSelect } from '../serverSelect';
import { syncContext, type SyncContext } from './support';

let c: SyncContext;

beforeEach(async () => {
  c = await syncContext();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  c.driver.close();
});

function selector(addresses: Servers = servers): ServerSelect {
  return createServerSelect({ http: c.http, clock: c.clock, kv: c.kv, servers: addresses });
}

function health(role: Server, status: 'ok' | 'degraded' = 'ok') {
  return response(200, { status, role, db: status === 'ok', disk_free_mb: 1_000,
    version: 'test', uptime_s: 60 });
}

async function advance(milliseconds: number): Promise<void> {
  c.clock.advance(milliseconds);
  await jest.advanceTimersByTimeAsync(milliseconds);
}

async function cycle(select: ServerSelect, reply: HttpReply): Promise<void> {
  c.http.enqueue(reply);
  const result = await requestHttp(c.http, { method: 'GET', url: `${servers.primary}/sync?since=0&limit=500` });
  await select.report('networkError' in result || !result.ok ? result : null);
}

function probes() {
  return c.http.requests.filter((request) => request.url.endsWith('/health'));
}

async function eligibleFailures(select: ServerSelect): Promise<void> {
  await cycle(select, new Error('simulated network failure'));
  await advance(30_000);
  await cycle(select, response(502));
  await advance(30_000);
}

async function moveToReserve(select: ServerSelect): Promise<void> {
  await eligibleFailures(select);
  // The cycle's reply precedes the selector's unauthenticated health reply.
  c.http.enqueue(response(504), health('reserve'));
  const result = await requestHttp(c.http, { method: 'GET', url: `${servers.primary}/sync?since=0&limit=500` });
  await select.report('networkError' in result || !result.ok ? result : null);
  expect(select.current()).toBe('reserve');
  expect(c.kv.get('active_server')).toBe('reserve');
}

test('RS-8: a fresh selector uses the primary without probing', () => {
  expect(selector().current()).toBe('primary');
  expect(c.http.requests).toEqual([]);
});

test('RS-8: two failures then a success stay on the primary and reset the streak', async () => {
  const select = selector();
  await cycle(select, new Error('simulated network failure'));
  await advance(30_000);
  await cycle(select, response(503));
  await advance(30_000);
  await cycle(select, response(200));
  await cycle(select, response(504));
  await advance(60_000);
  await cycle(select, response(502));
  expect(select.current()).toBe('primary');
  expect(probes()).toEqual([]);
});

test('RS-8: three failures inside sixty seconds never probe or move', async () => {
  const select = selector();
  await cycle(select, response(502));
  await advance(30_000);
  await cycle(select, response(503));
  await advance(29_999);
  await cycle(select, response(504));
  expect(select.current()).toBe('primary');
  expect(probes()).toEqual([]);
});

test('RS-8: three consecutive failures spanning exactly sixty seconds switch to a healthy reserve', async () => {
  const select = selector();
  await moveToReserve(select);
  expect(probes().map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'GET', url: `${servers.reserve}/health` },
  ]);
});

test.each([400, 401, 408, 425, 429, 500, 501])(
  'RS-8: HTTP %i answers break the network failure streak', async (status) => {
    const select = selector();
    await eligibleFailures(select);
    await cycle(select, response(status));
    await cycle(select, response(502));
    await advance(60_000);
    await cycle(select, response(503));
    expect(select.current()).toBe('primary');
    expect(probes()).toEqual([]);
  },
);

test.each([
  ['other role', health('primary')],
  ['degraded', health('reserve', 'degraded')],
  ['non-200', response(503)],
  ['network failure', new Error('simulated reserve health failure')],
] as const)('RS-8: reserve health with %s does not authorize a move', async (_name, reply) => {
  const select = selector();
  await eligibleFailures(select);
  c.http.enqueue(reply);
  await select.report({ ok: false, status: 504, body: null, headers: {} });
  expect(select.current()).toBe('primary');
  expect(probes()).toHaveLength(1);
});

test('RS-8: two healthy primary probes stay on the reserve and the third returns', async () => {
  const select = selector();
  await moveToReserve(select);
  await select.tick();
  expect(probes()).toHaveLength(1);
  for (let count = 1; count <= 3; count += 1) {
    await advance(59_999);
    await select.tick();
    expect(probes()).toHaveLength(count);
    c.http.enqueue(health('primary'));
    await advance(1);
    await select.tick();
    expect(select.current()).toBe(count === 3 ? 'primary' : 'reserve');
    await select.tick();
    expect(probes()).toHaveLength(count + 1);
  }
  expect(c.kv.get('active_server')).toBe('primary');
  await advance(60_000);
  await select.tick();
  expect(probes()).toHaveLength(4);
});

test.each([
  ['other role', health('reserve')],
  ['degraded', health('primary', 'degraded')],
  ['non-200', response(503)],
  ['network failure', new Error('simulated primary health failure')],
] as const)('RS-8: primary health with %s resets the return streak', async (_name, reply) => {
  const select = selector();
  await moveToReserve(select);
  for (const answer of [health('primary'), health('primary'), reply, health('primary'), health('primary')]) {
    c.http.enqueue(answer);
    await advance(60_000);
    await select.tick();
    expect(select.current()).toBe('reserve');
  }
  c.http.enqueue(health('primary'));
  await advance(60_000);
  await select.tick();
  expect(select.current()).toBe('primary');
});

test('RS-8: no reserve address means no probes and no moves', async () => {
  const select = selector({ primary: servers.primary });
  for (let count = 0; count < 5; count += 1) {
    await cycle(select, new Error('simulated network failure'));
    await advance(60_000);
    await select.tick();
  }
  expect(select.current()).toBe('primary');
  expect(probes()).toEqual([]);
});

test('RS-8: no network changes neither server nor sends a health probe', async () => {
  const select = selector();
  await select.report('offline');
  await advance(180_000);
  await select.report('offline');
  expect(select.current()).toBe('primary');
  expect(c.http.requests).toEqual([]);
});

test('RS-8: the reserve choice survives a new selector over the same kv', async () => {
  await moveToReserve(selector());
  const requests = c.http.requests.length;
  const restarted = selector();
  expect(restarted.current()).toBe('reserve');
  expect(c.http.requests).toHaveLength(requests);
  await advance(60_000);
  c.http.enqueue(health('primary'));
  await restarted.tick();
  expect(restarted.current()).toBe('reserve');
});

test('RS-9: probes carry no token, cursor or epoch and moves preserve both servers keys', async () => {
  const select = selector();
  const primaryEpoch = '00000000-0000-4000-8000-000000000041';
  const reserveEpoch = '00000000-0000-4000-8000-000000000042';
  for (const server of ['primary', 'reserve'] as const) {
    const epoch = server === 'primary' ? primaryEpoch : reserveEpoch;
    c.kv.set(serverKey('last_revision', server), server === 'primary' ? '900' : '5');
    c.kv.set(serverKey('sync_epoch', server), epoch);
    c.kv.set(serverKey('reseeded_epoch', server), epoch);
    await c.session.adopt(wireSession(server), server);
  }
  const secrets = c.secretBox.snapshot();
  await moveToReserve(select);
  const api = createApi({ ...c, servers, serverSelect: select });
  const arrive = jest.fn<Promise<PullResult>, [Server]>().mockResolvedValue('ok');
  const pull = createPull({ ...c, api, arrive });
  c.http.enqueue(response(200, { changes: [], revision: 6, has_more: false, epoch: reserveEpoch }));
  expect(await pull.pull()).toBe('ok');
  expect(c.http.requests.at(-1)).toMatchObject({
    url: `${servers.reserve}/sync?since=5&limit=500`,
    headers: { Authorization: `Bearer ${wireSession('reserve').access_token}` },
  });
  for (let count = 0; count < 3; count += 1) {
    c.http.enqueue(health('primary'));
    await advance(60_000);
    await select.tick();
  }
  expect(select.current()).toBe('primary');
  c.http.enqueue(response(200, { changes: [], revision: 901, has_more: false, epoch: primaryEpoch }));
  expect(await pull.pull()).toBe('ok');
  expect(c.http.requests.at(-1)).toMatchObject({
    url: `${servers.primary}/sync?since=900&limit=500`,
    headers: { Authorization: `Bearer ${wireSession('primary').access_token}` },
  });
  expect(arrive).not.toHaveBeenCalled();
  expect(c.kv.get('last_revision.reserve')).toBe('6');
  expect(c.kv.get('last_revision.primary')).toBe('901');
  for (const server of ['primary', 'reserve'] as const) {
    const epoch = server === 'primary' ? primaryEpoch : reserveEpoch;
    expect(c.kv.get(serverKey('sync_epoch', server))).toBe(epoch);
    expect(c.kv.get(serverKey('reseeded_epoch', server))).toBe(epoch);
  }
  expect(c.secretBox.snapshot()).toEqual(secrets);
  expect(probes()).toHaveLength(4);
  for (const request of probes()) {
    expect(request.method).toBe('GET');
    expect(request.headers ?? {}).toEqual({});
    expect(request.body).toBeUndefined();
    expect(request.url).toBe(request.url.includes('reserve.') ? `${servers.reserve}/health` : `${servers.primary}/health`);
  }
});

test.each([null, 'invalid health', {}, { role: 'reserve' }, { status: 'ok' }])(
  'RS-8: an incomplete health body %j cannot authorize a move', async (body) => {
    const select = selector();
    await eligibleFailures(select);
    c.http.enqueue(response(200, body));
    await select.report({ networkError: true });
    expect(select.current()).toBe('primary');
  },
);

test('RS-8: a later consecutive failure may complete the sixty-second span', async () => {
  const select = selector();
  for (let count = 0; count < 3; count += 1) await cycle(select, response(503));
  expect(probes()).toEqual([]);
  await advance(60_000);
  c.http.enqueue(health('reserve'));
  await select.report({ networkError: true });
  expect(select.current()).toBe('reserve');
});

test('RS-8: reserve cycle failures do not replace the healthy primary probe streak', async () => {
  const select = selector();
  await moveToReserve(select);
  for (let count = 0; count < 3; count += 1) {
    await select.report({ networkError: true });
    c.http.enqueue(health('primary'));
    await advance(60_000);
    await select.tick();
    expect(select.current()).toBe(count === 2 ? 'primary' : 'reserve');
  }
});
