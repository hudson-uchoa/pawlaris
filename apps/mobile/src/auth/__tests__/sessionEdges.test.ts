import { createApi } from '../../api/client';
import { serverKey } from '../../db/kv';
import type { SecretBox } from '../secretBox';
import { createSession, type Session } from '../session';
import { deferred, response, servers, sessionContext, wireSession, type SessionContext } from './support';

let context: SessionContext | undefined;
beforeEach(async () => { context = await sessionContext(); });
afterEach(() => { context?.driver.close(); context = undefined; });

function current(): SessionContext {
  if (context === undefined) throw new Error('Session test context is missing');
  return context;
}

const credentials = { email: 'family@example.invalid', password: 'fake-password-for-tests' };

async function signIn(ctx: SessionContext, session: Session) {
  ctx.http.enqueue(response(200, wireSession('primary')));
  const result = await session.login(credentials);
  if ('networkError' in result || !result.ok) throw new Error('Test sign-in failed');
  await session.adopt(result.body);
}

test.each([401, 429, 503])('SE-LOGIN-FAILURE: a failed login (%i) preserves prior session state', async (status) => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session);
  ctx.kv.set(serverKey('signed_out', 'primary'), '1');
  const before = ctx.secretBox.snapshot();
  const user = ctx.kv.get('session_user');
  ctx.http.enqueue(response(status, { code: 'fake_login_failure' }));
  expect(await session.login(credentials)).toEqual({ ok: false, ...response(status, { code: 'fake_login_failure' }) });
  expect(ctx.secretBox.snapshot()).toEqual(before);
  expect(ctx.kv.get('session_user')).toBe(user);
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBe('1');
});

test('SE-REFRESH-SIGNED-OUT: refresh cannot reuse tokens after the session has ended', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session);
  ctx.kv.set(serverKey('signed_out', 'primary'), '1');
  const before = ctx.http.requests.length;
  expect(await session.refresh()).toMatchObject({ ok: false, status: 401 });
  expect(ctx.http.requests).toHaveLength(before);
});

test('SE-ROTATION-PERSIST: refresh resolves only after the new token pair is durable', async () => {
  const ctx = current();
  await signIn(ctx, ctx.makeSession());
  const values = new Map(Object.entries(ctx.secretBox.snapshot()));
  const started = deferred<void>();
  const allowWrite = deferred<void>();
  const secretBox: SecretBox = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) {
      started.resolve();
      await allowWrite.promise;
      values.set(key, value);
    },
    async del(key) { values.delete(key); },
  };
  const session = createSession({ ...ctx, secretBox });
  ctx.http.enqueue(response(200, wireSession('primary', 'rotated')));
  let resolved = false;
  const pending = session.refresh().then((result) => { resolved = true; return result; });
  await started.promise;
  const resolvedBeforeWrite = resolved;
  const beforeWrite = Object.fromEntries(values);
  allowWrite.resolve();
  expect(await pending).toEqual({ ok: true, ...response(200, wireSession('primary', 'rotated')) });
  expect(resolvedBeforeWrite).toBe(false);
  expect(beforeWrite).toEqual(ctx.secretBox.snapshot());
  expect(JSON.stringify(Object.fromEntries(values))).toContain('fake-primary-refresh-rotated');
  expect(await session.accessToken()).toBe('fake-primary-access-rotated');
});

test('API-AUTH-HEADER / RS-9: caller headers cannot send a different bearer token', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  await signIn(ctx, session);
  ctx.http.enqueue(response(200));
  const api = createApi({ http: ctx.http, session, servers, activeServer: ctx.activeServer });
  await api.request('GET', '/me', undefined, {
    authorization: 'Bearer fake-reserve-access', Authorization: 'Bearer fake-reserve-access',
  });
  const sent = ctx.http.requests[1];
  expect(sent?.headers).toEqual({ Authorization: 'Bearer fake-primary-access-initial' });
  expect(JSON.stringify(sent)).not.toContain('fake-reserve-');
});

test.each([503, 429])('SE-REFRESH-TRANSIENT / RS-9: a %i preserves stored session state', async (status) => {
  const ctx = current();
  const session = ctx.makeSession();
  await session.adopt(wireSession('reserve'), 'reserve');
  await signIn(ctx, session);
  ctx.kv.set(serverKey('signed_out', 'reserve'), '1');
  const secrets = ctx.secretBox.snapshot();
  const user = ctx.kv.get('session_user');
  const primaryFlag = ctx.kv.get(serverKey('signed_out', 'primary'));
  const reserveFlag = ctx.kv.get(serverKey('signed_out', 'reserve'));
  ctx.http.enqueue(response(status, { code: 'fake_refresh_failure' }));
  expect(await session.refresh()).toEqual({
    ok: false, ...response(status, { code: 'fake_refresh_failure' }),
  });
  expect(ctx.secretBox.snapshot()).toEqual(secrets);
  expect(ctx.kv.get('session_user')).toBe(user);
  expect(ctx.kv.get(serverKey('signed_out', 'primary'))).toBe(primaryFlag);
  expect(ctx.kv.get(serverKey('signed_out', 'reserve'))).toBe(reserveFlag);
  ctx.http.enqueue(response(200, wireSession('primary', 'recovered')));
  expect(await ctx.makeSession().refresh()).toEqual({
    ok: true, ...response(200, wireSession('primary', 'recovered')),
  });
  expect(ctx.http.requests.slice(-2)).toEqual([
    {
      method: 'POST', url: `${servers.primary}/auth/refresh`,
      body: { refresh_token: 'fake-primary-refresh-initial' }, timeoutMs: 15_000,
    },
    {
      method: 'POST', url: `${servers.primary}/auth/refresh`,
      body: { refresh_token: 'fake-primary-refresh-initial' }, timeoutMs: 15_000,
    },
  ]);
});

test('SE-REDEEM-ACTIVE / RS-9: redeem uses the reserve address when it is active', async () => {
  const ctx = current();
  const session = ctx.makeSession();
  ctx.select('reserve');
  const body = { ...credentials, code: 'FAKECODE01', display_name: 'Test member' };
  const wire = wireSession('reserve', 'redeemed');
  ctx.http.enqueue(response(200, wire));
  expect(await session.redeem(body)).toEqual({ ok: true, ...response(200, wire) });
  expect(ctx.http.requests).toEqual([{
    method: 'POST', url: `${servers.reserve}/auth/redeem`, body, timeoutMs: 15_000,
  }]);
});
