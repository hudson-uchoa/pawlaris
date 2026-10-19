import { response, servers, wireSession } from '../../../auth/__tests__/support';
import { createFamilyActions } from '../../../auth/familyActions';
import { settingsContext, type SettingsContext } from '../../settings/__tests__/support';

let context: SettingsContext | undefined;

afterEach(() => { context?.dispose(); context = undefined; });

async function scene(options: Parameters<typeof settingsContext>[0] = {}) {
  const c = await settingsContext(options);
  context = c;
  if (options.server === 'reserve') {
    c.kv.set('active_server', 'reserve');
    await c.session.adopt(wireSession('reserve'), 'reserve');
  }
  const kick = jest.fn(async () => {});
  const actions = createFamilyActions({ ...c, connection: c.services.connection,
    sessionUser: c.services.sessionUser, changePassword: c.actions.changePassword, kick });
  return { ...c, actions, kick };
}

test.each(['primary', 'reserve'] as const)('R7.1 PATCH family on %s applies its returned row with an idempotency key', async (server) => {
  const c = await scene({ server });
  const row = { ...c.family, name: 'Changed family', timezone: 'Europe/Lisbon', revision: 12 };
  c.http.enqueue(response(200, row));
  await c.actions.patchFamily({ name: row.name, timezone: row.timezone });
  expect(c.http.requests[0]).toMatchObject({ method: 'PATCH', url: `${servers[server]}/family`,
    body: { name: row.name, timezone: row.timezone },
    headers: { 'Idempotency-Key': expect.any(String) } });
  expect(c.store.getState().family).toEqual(row);
  expect(c.replica.get('family', row.id)?.pending).toBe(false);
  expect(c.outbox.count()).toBe(0);
});

test('R7.1 invite returns the code and writes no replica or outbox row', async () => {
  const c = await scene();
  const invite = { code: '7K2M9QX4TB', role: 'member', expires_at: '2026-10-20T12:00:00Z' };
  c.http.enqueue(response(200, invite));
  expect(await c.actions.invite('member')).toEqual(invite);
  expect(c.http.requests[0]).toMatchObject({ method: 'POST', body: { role: 'member' } });
  expect(c.http.requests[0]?.headers).not.toHaveProperty('Idempotency-Key');
  expect(c.outbox.count()).toBe(0);
});

test('R7.1 role changes apply the server role and each write has a fresh key', async () => {
  const c = await scene();
  c.http.enqueue(response(200, { ...c.member, role: 'member', revision: 15 }),
    response(200, { ...c.member, role: 'leader', revision: 16 }));
  await c.actions.changeRole(c.member.id, 'member');
  expect(c.store.getState().members[c.member.id]?.role).toBe('member');
  await c.actions.changeRole(c.member.id, 'leader');
  expect(c.store.getState().members[c.member.id]?.role).toBe('leader');
  const keys = c.http.requests.map((request) => request.headers?.['Idempotency-Key']);
  expect(keys.every((key) => typeof key === 'string')).toBe(true);
  expect(new Set(keys).size).toBe(2);
});

test('R1.20 removal applies the disabled member then pulls changed task assignments', async () => {
  const c = await scene();
  const removed = { ...c.member, disabled_at: '2026-10-19T12:00:00Z', revision: 18 };
  c.http.enqueue(response(200, removed));
  await c.actions.removeMember(c.member.id);
  expect(c.store.getState().members[c.member.id]).toEqual(removed);
  expect(c.http.requests[0]).toMatchObject({ method: 'DELETE',
    headers: { 'Idempotency-Key': expect.any(String) } });
  expect(c.kick).toHaveBeenCalledWith('refresh');
});

test('Q-46 PATCH me updates the cached account and pulls a revisioned member row', async () => {
  const c = await scene({ role: 'member' });
  const user = { ...c.user, display_name: 'Changed member' };
  c.http.enqueue(response(200, user));
  await c.actions.patchProfile({ display_name: user.display_name });
  expect(JSON.parse(c.kv.get('session_user') ?? 'null') as unknown).toEqual(user);
  expect(c.kick).toHaveBeenCalledWith('refresh');
  expect(c.http.requests[0]).toMatchObject({ method: 'PATCH', body: { display_name: user.display_name } });
  expect(c.http.requests[0]?.headers).not.toHaveProperty('Idempotency-Key');
  expect(c.outbox.count()).toBe(0);
});

test.each(['offline', 'reserve'] as const)('RS-6 account actions refuse %s before calling HTTP', async (mode) => {
  const c = await scene(mode === 'offline' ? { status: 'offline' } : { server: 'reserve' });
  await expect(c.actions.invite('member')).rejects.toMatchObject({ code: 'unavailable' });
  await expect(c.actions.changeRole(c.member.id, 'member')).rejects.toMatchObject({ code: 'unavailable' });
  await expect(c.actions.removeMember(c.member.id)).rejects.toMatchObject({ code: 'unavailable' });
  await expect(c.actions.patchProfile({ display_name: 'Changed name' })).rejects.toMatchObject({ code: 'unavailable' });
  if (mode === 'offline') await expect(c.actions.patchFamily({ name: 'Changed family' }))
    .rejects.toMatchObject({ code: 'unavailable' });
  expect(c.http.requests).toEqual([]);
});

test('R1.16 the replicated role overrides an old leader session for administration', async () => {
  const c = await scene();
  c.apply.applyServerRows([{ entity: 'members', row: c.factory.members({ id: c.user.id, role: 'member' }) }]);
  await expect(c.actions.patchFamily({ name: 'Changed family' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(c.http.requests).toEqual([]);
});

test('R1.16 a missing session cannot administer the family', async () => {
  const c = await scene();
  const actions = createFamilyActions({ ...c, connection: c.services.connection,
    sessionUser: () => null, changePassword: c.actions.changePassword });
  await expect(actions.invite('leader')).rejects.toMatchObject({ code: 'unavailable' });
  expect(c.http.requests).toEqual([]);
});

test('R1.16 administration before the first member pull uses the cached account role', async () => {
  const c = await scene({ role: 'member' });
  c.apply.removeRow('members', c.user.id);
  await expect(c.actions.invite('member')).rejects.toMatchObject({ code: 'forbidden' });
  expect(c.http.requests).toEqual([]);
});

test.each([
  { reply: response(409, { code: 'last_leader' }), code: 'last_leader' },
  { reply: response(500, null), code: 'unavailable' },
  { reply: new Error('Test network failure'), code: 'unavailable' },
])('FM-1 failed administration preserves the replica ($code)', async ({ reply, code }) => {
  const c = await scene();
  const before = c.store.getState();
  c.http.enqueue(reply);
  await expect(c.actions.changeRole(c.member.id, 'member')).rejects.toMatchObject({ code });
  expect(c.store.getState()).toBe(before);
  expect(c.outbox.count()).toBe(0);
});
