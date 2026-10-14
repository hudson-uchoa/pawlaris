import { createApi } from '../../api/client';
import { serverKey, type Server } from '../../db/kv';
import type { HttpResponse } from '../../platform/http';
import type { Session } from '../session';
import {
  deferred, response, servers, sessionContext, wireSession, type SessionContext,
} from './support';

let context: SessionContext | undefined;
beforeEach(async () => { context = await sessionContext(); });
afterEach(() => { context?.driver.close(); context = undefined; });

function current(): SessionContext {
  if (context === undefined) throw new Error('Session test context is missing');
  return context;
}

const credentials = { email: 'family@example.invalid', password: 'fake-password-for-tests' };

async function signIn(ctx: SessionContext, session: Session, server: Server, remaining = 900_000) {
  ctx.select(server);
  const wire = wireSession(server, 'initial', remaining);
  ctx.http.enqueue(response(200, wire));
  await session.login(credentials);
  return wire;
}

function seedLocalIntent(ctx: SessionContext) {
  const pet = ctx.factory.pets();
  ctx.replica.upsert('pets', pet, { pending: true, deleted: false, pullGen: 0 });
  const queued = ctx.outbox.insert(ctx.factory.outbox());
  return { pet, queued };
}

test('SE-1: five simultaneous 401s share one refresh and all succeed on retry', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session, 'primary');
  const started = deferred<void>();
  const rotated = deferred<HttpResponse>();
  ctx.http.enqueue(
    ...Array.from({ length: 5 }, () => response(401)),
    () => { started.resolve(); return rotated.promise; },
    ...Array.from({ length: 5 }, () => response(200, { id: 'fake-row' })),
  );
  const api = createApi({ http: ctx.http, session, servers, activeServer: ctx.activeServer });
  const all = Promise.all(Array.from({ length: 5 }, () => api.request('GET', '/me')));
  await started.promise;
  const refreshCalls = ctx.http.requests.filter((req) => req.url.endsWith('/auth/refresh'));
  rotated.resolve(response(200, wireSession('primary', 'rotated')));
  expect(refreshCalls).toHaveLength(1);
  expect(refreshCalls[0]).toMatchObject({
    method: 'POST', url: `${servers.primary}/auth/refresh`,
    body: { refresh_token: 'fake-primary-refresh-initial' },
  });
  expect(await all).toEqual(Array.from({ length: 5 }, () => ({
    ok: true, ...response(200, { id: 'fake-row' }),
  })));
  const resourceRequests = ctx.http.requests.filter((req) => req.url.endsWith('/me'));
  expect(resourceRequests).toHaveLength(10);
  expect(resourceRequests.slice(5).map((req) => req.headers?.Authorization))
    .toEqual(Array.from({ length: 5 }, () => 'Bearer fake-primary-access-rotated'));
  expect(JSON.stringify(ctx.secretBox.snapshot())).toContain('fake-primary-refresh-rotated');
  expect(await ctx.makeSession().accessToken()).toBe('fake-primary-access-rotated');
  expect(ctx.http.requests.filter((req) => req.url.endsWith('/auth/refresh'))).toHaveLength(1);
});

test.each([30_001, 900_000])(
  'SE-4: a cold start with %i ms remaining uses the stored access token', async (remaining) => {
    const ctx = current();
    await signIn(ctx, ctx.makeSession(), 'primary', remaining);
    const before = ctx.http.requests.length;
    expect(await ctx.makeSession().accessToken()).toBe('fake-primary-access-initial');
    expect(ctx.http.requests).toHaveLength(before);
    expect(ctx.http.requests.filter((req) => req.url.endsWith('/auth/refresh'))).toHaveLength(0);
  },
);

test.each([30_000, 29_999, 0, -1])(
  'SE-4-EXPIRY: an access token with %i ms remaining refreshes', async (remaining) => {
    const ctx = current();
    const session = ctx.makeSession();
    await signIn(ctx, session, 'primary', remaining);
    ctx.http.enqueue(response(200, wireSession('primary', 'rotated')));
    expect(await ctx.makeSession().accessToken()).toBe('fake-primary-access-rotated');
    expect(ctx.http.requests.filter((req) => req.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(JSON.stringify(ctx.secretBox.snapshot())).toContain('fake-primary-refresh-rotated');
    expect(JSON.stringify(ctx.secretBox.snapshot())).toContain(wireSession('primary', 'rotated').access_expires_at);
  },
);

test('SE-REFRESH-NETWORK: a network failure preserves the session and allows a later refresh', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session, 'primary');
  const local = seedLocalIntent(ctx);
  const secrets = ctx.secretBox.snapshot();
  const user = ctx.kv.get('session_user');
  ctx.clock.advance(900_000);
  ctx.http.enqueue(new Error('Fake network failure'));
  expect(await session.accessToken()).toEqual({ networkError: true });
  expect(ctx.secretBox.snapshot()).toEqual(secrets);
  expect(ctx.kv.get('session_user')).toBe(user);
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBeNull();
  expect(ctx.outbox.head(local.queued.userId)).toEqual(local.queued);
  expect(ctx.replica.get('pets', local.pet.id)?.row).toEqual(local.pet);
  ctx.http.enqueue(response(200, wireSession('primary', 'recovered', 1_800_000)));
  expect(await session.accessToken()).toBe('fake-primary-access-recovered');
  const refreshCalls = ctx.http.requests.filter((req) => req.url.endsWith('/auth/refresh'));
  expect(refreshCalls).toHaveLength(2);
  expect(refreshCalls.map((req) => req.body)).toEqual([
    { refresh_token: 'fake-primary-refresh-initial' },
    { refresh_token: 'fake-primary-refresh-initial' },
  ]);
});

test('SE-REFRESH-401 / SE-2: a 401 ends the session and preserves local intent across restart', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session, 'primary');
  const local = seedLocalIntent(ctx);
  const user = ctx.kv.get('session_user');
  ctx.http.enqueue(response(401, { code: 'token_invalid' }));
  expect(await session.refresh()).toEqual({ ok: false, ...response(401, { code: 'token_invalid' }) });
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBe('1');
  expect(ctx.kv.get('session_user')).toBe(user);
  expect(ctx.outbox.head(local.queued.userId)).toEqual(local.queued);
  expect(ctx.replica.get('pets', local.pet.id)?.row).toEqual(local.pet);
  const before = ctx.http.requests.length;
  expect(await ctx.makeSession().accessToken()).toMatchObject({ ok: false, status: 401 });
  expect(ctx.http.requests).toHaveLength(before);
});

test('SE-LOGIN: same-user login clears signed_out and preserves the outbox and replica', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  const wire = await signIn(ctx, session, 'primary');
  const local = seedLocalIntent(ctx);
  ctx.kv.set(serverKey('signed_out', 'primary'), '1');
  ctx.http.enqueue(response(200, wireSession('primary', 'new-login')));
  expect(await session.login(credentials)).toEqual({
    ok: true, ...response(200, wireSession('primary', 'new-login')),
  });
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBeNull();
  expect(JSON.parse(ctx.kv.get('session_user') ?? 'null')).toEqual(wire.user);
  expect(ctx.outbox.head(local.queued.userId)).toEqual(local.queued);
  expect(ctx.replica.get('pets', local.pet.id)?.row).toEqual(local.pet);
  expect(await ctx.makeSession().accessToken()).toBe('fake-primary-access-new-login');
});

test('SE-LOGIN-STORAGE / R1.7: tokens and expiry persist only in SecretBox', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  const wire = await signIn(ctx, session, 'primary');
  const secrets = JSON.stringify(ctx.secretBox.snapshot());
  expect(secrets).toContain(wire.access_token);
  expect(secrets).toContain(wire.refresh_token);
  expect(secrets).toContain(wire.access_expires_at);
  expect(JSON.parse(ctx.kv.get('session_user') ?? 'null')).toEqual(wire.user);
  const sqlite = JSON.stringify(ctx.driver.all('SELECT key, value FROM kv'));
  expect(sqlite).not.toContain(wire.access_token);
  expect(sqlite).not.toContain(wire.refresh_token);
  expect(sqlite).not.toContain(wire.access_expires_at);
  expect(ctx.http.requests[0]).toMatchObject({
    method: 'POST', url: `${servers.primary}/auth/login`, body: credentials,
  });
  expect(ctx.http.requests[0]?.headers?.Authorization).toBeUndefined();
});

test('SE-REDEEM: send the wire body and persist the returned session', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  const body = { ...credentials, code: 'FAKECODE01', display_name: 'Test member' };
  const wire = wireSession('primary', 'redeemed');
  ctx.kv.set(serverKey('signed_out', 'primary'), '1');
  ctx.http.enqueue(response(200, wire));
  expect(await session.redeem(body)).toEqual({ ok: true, ...response(200, wire) });
  expect(ctx.http.requests).toHaveLength(1);
  expect(ctx.http.requests[0]).toMatchObject({
    method: 'POST', url: `${servers.primary}/auth/redeem`, body,
  });
  expect(ctx.http.requests[0]?.headers?.Authorization).toBeUndefined();
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBeNull();
  expect(await ctx.makeSession().accessToken()).toBe(wire.access_token);
  expect(JSON.stringify(ctx.secretBox.snapshot())).toContain(wire.refresh_token);
});

test.each<Server>(['primary', 'reserve'])(
  'RS-9: login, refresh and refresh-401 on %s preserve the other session and flag', async (server) => {
    const ctx = current();
    const session = ctx.makeSession();
    const other: Server = server === 'primary' ? 'reserve' : 'primary';
    await signIn(ctx, session, other);
    const otherSecrets = ctx.secretBox.snapshot();
    ctx.kv.set(serverKey('signed_out', other), '1');
    ctx.kv.set(serverKey('last_revision', other), '17');
    ctx.kv.set(serverKey('sync_epoch', other), `fake-${other}-epoch`);
    ctx.kv.set(serverKey('reseeded_epoch', other), `fake-${other}-reseeded-epoch`);
    ctx.kv.set(serverKey('signed_out', server), '1');
    const start = ctx.http.requests.length;
    await signIn(ctx, session, server);
    expect(ctx.secretBox.snapshot()).toMatchObject(otherSecrets);
    expect(ctx.kv.get(serverKey('signed_out', server))).toBeNull();
    ctx.http.enqueue(response(200, wireSession(server, 'rotated')));
    expect(await session.refresh()).toEqual({ ok: true, ...response(200, wireSession(server, 'rotated')) });
    expect(ctx.secretBox.snapshot()).toMatchObject(otherSecrets);
    ctx.http.enqueue(response(401, { code: 'token_invalid' }));
    expect(await session.refresh()).toMatchObject({ ok: false, status: 401 });
    expect(ctx.secretBox.snapshot()).toMatchObject(otherSecrets);
    expect(ctx.kv.get(serverKey('signed_out', server))).toBe('1');
    expect(ctx.kv.get(serverKey('signed_out', other))).toBe('1');
    expect(ctx.kv.get(serverKey('last_revision', other))).toBe('17');
    expect(ctx.kv.get(serverKey('sync_epoch', other))).toBe(`fake-${other}-epoch`);
    expect(ctx.kv.get(serverKey('reseeded_epoch', other))).toBe(`fake-${other}-reseeded-epoch`);
    const sent = ctx.http.requests.slice(start);
    expect(sent.every((req) => req.url.startsWith(servers[server]))).toBe(true);
    expect(sent.filter((req) => req.url.endsWith('/auth/refresh')).map((req) => req.body)).toEqual([
      { refresh_token: `fake-${server}-refresh-initial` },
      { refresh_token: `fake-${server}-refresh-rotated` },
    ]);
    for (const req of sent) expect(JSON.stringify(req)).not.toContain(`fake-${other}-`);
  },
);

test('RS-9: a server without a session cannot borrow the other server refresh token', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session, 'primary');
  const primarySecrets = ctx.secretBox.snapshot();
  const before = ctx.http.requests.length;
  ctx.select('reserve');
  expect(await session.accessToken()).toMatchObject({ ok: false, status: 401 });
  expect(ctx.kv.get(serverKey('signed_out', 'reserve'))).toBe('1');
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBeNull();
  expect(ctx.secretBox.snapshot()).toEqual(primarySecrets);
  expect(ctx.http.requests).toHaveLength(before);
});

test('RS-9: simultaneous refreshes on two servers use separate flights and tokens', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session, 'primary');
  await signIn(ctx, session, 'reserve');
  const startedPrimary = deferred<void>();
  const startedReserve = deferred<void>();
  const primary = deferred<HttpResponse>();
  const reserve = deferred<HttpResponse>();
  ctx.http.enqueue(
    () => { startedPrimary.resolve(); return primary.promise; },
    () => { startedReserve.resolve(); return reserve.promise; },
  );
  ctx.select('primary');
  const first = session.refresh();
  await startedPrimary.promise;
  ctx.select('reserve');
  const second = session.refresh();
  await startedReserve.promise;
  primary.resolve(response(200, wireSession('primary', 'rotated')));
  reserve.resolve(response(200, wireSession('reserve', 'rotated')));
  expect(await first).toEqual({ ok: true, ...response(200, wireSession('primary', 'rotated')) });
  expect(await second).toEqual({ ok: true, ...response(200, wireSession('reserve', 'rotated')) });
  const requests = ctx.http.requests.filter((req) => req.url.endsWith('/auth/refresh'));
  expect(requests.map((req) => [req.url, req.body])).toEqual([
    [`${servers.primary}/auth/refresh`, { refresh_token: 'fake-primary-refresh-initial' }],
    [`${servers.reserve}/auth/refresh`, { refresh_token: 'fake-reserve-refresh-initial' }],
  ]);
  expect(await session.accessToken('primary')).toBe('fake-primary-access-rotated');
  expect(await session.accessToken('reserve')).toBe('fake-reserve-access-rotated');
});

test('SE-CLEAR / RS-9: clear the active server tokens without clearing the other session', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session, 'reserve');
  const reserveSecrets = ctx.secretBox.snapshot();
  await signIn(ctx, session, 'primary');
  await session.clear();
  expect(ctx.secretBox.snapshot()).toEqual(reserveSecrets);
});
