import { deferred, response, servers, wireSession } from '../../auth/__tests__/support';
import type { Server } from '../../db/kv';
import type { HttpResponse } from '../../platform/http';
import { fakeRandom } from '../../testing/fakeRandom';
import { createEngine, type ConnectionState, type Engine, type EngineDependencies } from '../engine';
import { createPull, type PullResult } from '../pull';
import type { Socket, SocketState } from '../socket';
import { petMutation, seedMutation, syncContext, type SyncContext } from './support';

const syncEpoch = '00000000-0000-4000-8000-000000000031';
let c: SyncContext;
let engine: Engine | undefined;

beforeEach(async () => {
  c = await syncContext(undefined, Array.from({ length: 12 }, () => 0.5));
  c.kv.set('reseeded_epoch.primary', syncEpoch);
  c.kv.set('reseeded_epoch.reserve', syncEpoch);
  jest.useFakeTimers();
});

afterEach(() => {
  engine?.dispose();
  engine = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  c.driver.close();
});

function page(revision = 7): HttpResponse {
  return response(200, { changes: [], revision, has_more: false, epoch: syncEpoch });
}

function makeEngine(options: Partial<EngineDependencies> = {}) {
  let selected: Server = c.kv.get('active_server') === 'reserve' ? 'reserve' : 'primary';
  const sockets: {
    server: Server; socket: Socket; onRevision(revision: number): void;
    open(): void; disconnect(): void; connect: jest.Mock; close: jest.Mock;
  }[] = [];
  const createSocket = (server: Server, onRevision: (revision: number) => void): Socket => {
    let state: SocketState = 'closed';
    const connect = jest.fn(async () => { state = 'connecting'; });
    const close = jest.fn(() => { state = 'closed'; });
    const socket: Socket = { get state() { return state; }, connect, close };
    sockets.push({ server, socket, onRevision, connect, close,
      open() { state = 'open'; }, disconnect() { state = 'closed'; } });
    return socket;
  };
  const arrive = jest.fn<Promise<PullResult>, [Server]>(async (server) => {
    c.kv.set('active_server', server);
    return 'ok';
  });
  const dependencies: EngineDependencies = {
    driver: c.driver, secretBox: c.secretBox, clock: c.clock,
    random: fakeRandom(...Array.from({ length: 12 }, () => 0.5)),
    serverSelect: { current: () => selected }, arrive, outbox: c.drain,
    pull: createPull({ driver: c.driver, apply: c.apply, api: c.api, arrive }),
    createSocket, online: true, foreground: false, ...options,
  };
  const created = createEngine(dependencies);
  engine = created;
  return { engine: created, dependencies, sockets, arrive,
    select(server: Server) { selected = server; } };
}

async function advance(milliseconds: number) {
  c.clock.advance(milliseconds);
  await jest.advanceTimersByTimeAsync(milliseconds);
}

test('ENGINE-ORDER: drain acknowledgements land before the pull starts', async () => {
  const mutation = petMutation(c, 'Queued pet');
  seedMutation(c, mutation);
  const ack = deferred<HttpResponse>();
  const started = deferred<void>();
  c.http.enqueue(() => { started.resolve(); return ack.promise; }, page());
  const { engine: created } = makeEngine();
  const states: ConnectionState[] = [];
  const unsubscribe = created.state.subscribe((state) => { states.push(state); });
  const cycle = created.kick('start');
  await started.promise;
  expect(c.http.requests.map((request) => request.method)).toEqual(['POST']);
  expect(created.state.getState()).toEqual({ status: 'syncing', server: 'primary', outboxCount: 1 });
  ack.resolve(response(200, { ...mutation.localRow, revision: 6 }));
  await cycle;
  expect(c.http.requests.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'POST', url: `${servers.primary}/pets` },
    { method: 'GET', url: `${servers.primary}/sync?since=0&limit=500` },
  ]);
  expect(c.replica.get('pets', mutation.entityId)).toMatchObject({ pending: false, revision: 6 });
  expect(c.outbox.count()).toBe(0);
  expect(created.state.getState()).toEqual({ status: 'synced', server: 'primary', outboxCount: 0 });
  expect(states).toEqual(expect.arrayContaining([
    { status: 'syncing', server: 'primary', outboxCount: 1 },
    { status: 'synced', server: 'primary', outboxCount: 0 },
  ]));
  const length = states.length;
  unsubscribe();
  c.http.enqueue(page(8));
  await created.kick('refresh');
  expect(states).toHaveLength(length);
});

test('ENGINE-RERUN: several kicks during one cycle cause exactly one subsequent cycle', async () => {
  const held = deferred<HttpResponse>();
  const started = deferred<void>();
  let active = 0;
  let maximum = 0;
  c.http.enqueue(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    started.resolve();
    const reply = await held.promise;
    active -= 1;
    return reply;
  }, () => {
    maximum = Math.max(maximum, active + 1);
    return page(8);
  });
  const { engine: created } = makeEngine();
  const cycle = created.kick('start');
  await started.promise;
  const kicks = [created.kick('poke'), created.kick('mutation'), created.kick('refresh')];
  expect(c.http.requests).toHaveLength(1);
  held.resolve(page());
  await Promise.all([cycle, ...kicks]);
  await advance(0);
  expect(c.http.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/sync?since=0&limit=500`, `${servers.primary}/sync?since=7&limit=500`,
  ]);
  expect(maximum).toBe(1);
  expect(c.kv.get('last_revision.primary')).toBe('8');
});

test.each<Server>(['primary', 'reserve'])(
  'ENGINE-STATE-SYNCED / RS-9: a clean cycle names its active %s server', async (server) => {
    c.kv.set('active_server', server);
    await c.session.adopt(wireSession(server), server);
    c.http.enqueue(page());
    const { engine: created } = makeEngine();
    await created.kick('start');
    expect(created.state.getState()).toEqual({ status: 'synced', server, outboxCount: 0 });
    expect(c.http.requests[0]?.url).toBe(`${servers[server]}/sync?since=0&limit=500`);
  },
);

test('ENGINE-STATE-OFFLINE: unreachable network sends nothing and keeps local intent', async () => {
  const mutation = petMutation(c, 'Offline pet');
  const queued = seedMutation(c, mutation);
  const before = c.store.getState();
  const { engine: created, sockets } = makeEngine({ online: false, foreground: true });
  await created.kick('start');
  expect(created.state.getState()).toEqual({ status: 'offline', server: 'primary', outboxCount: 1 });
  expect(c.http.requests).toEqual([]);
  expect(c.outbox.head(c.sessionUser.id)).toEqual(queued);
  expect(c.store.getState()).toBe(before);
  expect(sockets.every((socket) => socket.connect.mock.calls.length === 0)).toBe(true);
});

test('ENGINE-STATE-SYNCING: a deferred outbox head keeps its count visible after a clean pull', async () => {
  const queued = seedMutation(c, petMutation(c, 'Waiting pet'));
  c.outbox.update(queued.seq, { attempts: 1, serverErrors: 0,
    nextRetryAt: c.clock.now() + 5_000, lastError: 'HTTP 429' });
  c.http.enqueue(page());
  const { engine: created } = makeEngine();
  await created.kick('start');
  expect(created.state.getState()).toEqual({ status: 'syncing', server: 'primary', outboxCount: 1 });
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]?.method).toBe('GET');
});

test('ENGINE-STATE-SIGNED-OUT: an expired session takes precedence over an unreachable network', async () => {
  seedMutation(c, petMutation(c, 'Kept pet'));
  c.kv.set('signed_out.primary', '1');
  const before = c.store.getState();
  const { engine: created } = makeEngine({ online: false });
  await created.kick('start');
  expect(created.state.getState()).toEqual({ status: 'signed_out', server: 'primary', outboxCount: 1 });
  expect(c.http.requests).toEqual([]);
  expect(c.outbox.count()).toBe(1);
  expect(c.store.getState()).toBe(before);
});

test('ENGINE-STARTUP: no session_user starts at the login screen even if a token remains', async () => {
  c.kv.remove('session_user');
  const { engine: created } = makeEngine();
  expect(created.state.getState().status).toBe('signed_out');
  await created.kick('start');
  expect(c.http.requests).toEqual([]);
  expect(created.state.getState().status).toBe('signed_out');
});

test('ENGINE-STATE-AUTH-PULL / SE-2: an unrefreshable pull keeps the replica and closes the socket', async () => {
  const pet = c.factory.pets();
  c.apply.applyServerRows([{ entity: 'pets', row: pet }]);
  c.http.enqueue(response(401), response(401));
  const { engine: created, sockets } = makeEngine({ foreground: true });
  await created.kick('start');
  expect(c.kv.get('signed_out.primary')).toBe('1');
  expect(created.state.getState().status).toBe('signed_out');
  expect(c.store.getState().pets[pet.id]).toEqual(pet);
  expect(sockets.every((socket) => socket.socket.state === 'closed')).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('ENGINE-RETRY-PULL: an empty outbox still retries a failed pull with growing backoff and a reset', async () => {
  c.http.enqueue(new Error('simulated pull network failure'), new Error('simulated pull network failure'), page());
  const { engine: created } = makeEngine();
  await created.kick('start');
  expect(created.state.getState().status).toBe('offline');
  expect(c.outbox.count()).toBe(0);
  await advance(1_499);
  expect(c.http.requests).toHaveLength(1);
  await advance(1);
  expect(c.http.requests).toHaveLength(2);
  await advance(2_999);
  expect(c.http.requests).toHaveLength(2);
  await advance(1);
  expect(c.http.requests).toHaveLength(3);
  expect(created.state.getState().status).toBe('synced');
  expect(jest.getTimerCount()).toBe(0);
  c.http.enqueue(new Error('simulated next pull failure'), page(8));
  await created.kick('refresh');
  await advance(1_499);
  expect(c.http.requests).toHaveLength(4);
  await advance(1);
  expect(c.http.requests).toHaveLength(5);
  expect(created.state.getState().status).toBe('synced');
});

test('ENGINE-RETRY-OUTBOX: the head retry fires at its durable deadline without overtaking', async () => {
  const mutation = petMutation(c, 'Retry pet');
  seedMutation(c, mutation);
  c.http.enqueue(new Error('simulated drain network failure'), page(),
    response(200, { ...mutation.localRow, revision: 8 }), page(9));
  const { engine: created } = makeEngine();
  await created.kick('start');
  expect(created.state.getState().status).toBe('offline');
  expect(c.http.requests.map((request) => request.method)).toEqual(['POST', 'GET']);
  expect(c.outbox.head(c.sessionUser.id)?.nextRetryAt).toBe(c.clock.now() + 1_500);
  await advance(1_499);
  expect(c.http.requests).toHaveLength(2);
  await advance(1);
  expect(c.http.requests.map((request) => request.method)).toEqual(['POST', 'GET', 'POST', 'GET']);
  expect(c.http.requests[2]?.headers?.['Idempotency-Key']).toBe(mutation.clientMutationId);
  expect(c.outbox.count()).toBe(0);
  expect(created.state.getState().status).toBe('synced');
});

test('ENGINE-RETRY-EARLIEST: a failed pull retries before the later outbox deadline', async () => {
  const mutation = petMutation(c, 'Later retry');
  seedMutation(c, mutation);
  c.http.enqueue({ ...response(429), headers: { 'Retry-After': '5' } },
    new Error('simulated pull failure'), page(),
    response(200, { ...mutation.localRow, revision: 8 }), page(9));
  const { engine: created } = makeEngine();
  await created.kick('start');
  await advance(1_499);
  expect(c.http.requests).toHaveLength(2);
  await advance(1);
  expect(c.http.requests.map((request) => request.method)).toEqual(['POST', 'GET', 'GET']);
  expect(c.outbox.count()).toBe(1);
  await advance(3_499);
  expect(c.http.requests).toHaveLength(3);
  await advance(1);
  expect(c.http.requests.map((request) => request.method)).toEqual(['POST', 'GET', 'GET', 'POST', 'GET']);
  expect(c.outbox.count()).toBe(0);
});

test('ENGINE-FALLBACK: a closed foreground socket pulls every sixty seconds and background stops it', async () => {
  c.http.enqueue(page(), page(8), page(9));
  const { engine: created, sockets } = makeEngine({ foreground: true });
  await created.kick('start');
  await advance(59_999);
  expect(c.http.requests).toHaveLength(1);
  await advance(1);
  expect(c.http.requests).toHaveLength(2);
  await advance(60_000);
  expect(c.http.requests).toHaveLength(3);
  created.setForeground(false);
  expect(sockets.every((socket) => socket.socket.state === 'closed')).toBe(true);
  await advance(180_000);
  expect(c.http.requests).toHaveLength(3);
  expect(jest.getTimerCount()).toBe(0);
});

test('ENGINE-FALLBACK-OPEN: an open socket suppresses fallback pulls until it disconnects', async () => {
  c.http.enqueue(page(), page(8));
  const { engine: created, sockets } = makeEngine({ foreground: true });
  await created.kick('start');
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('Expected the foreground socket');
  socket.open();
  await advance(60_000);
  expect(c.http.requests).toHaveLength(1);
  socket.disconnect();
  await advance(60_000);
  expect(c.http.requests).toHaveLength(2);
});

test('ENGINE-TRIGGERS: foreground and network recovery kick immediately without duplicate transitions', async () => {
  const { engine: created, sockets } = makeEngine({ online: false, foreground: false });
  await created.kick('start');
  c.http.enqueue(page(), page(8));
  created.setOnline(true);
  await advance(0);
  expect(c.http.requests).toHaveLength(1);
  created.setOnline(true);
  await advance(0);
  expect(c.http.requests).toHaveLength(1);
  created.setForeground(true);
  await advance(0);
  expect(c.http.requests).toHaveLength(2);
  expect(sockets.at(-1)?.connect).toHaveBeenCalledTimes(1);
  created.setForeground(true);
  await advance(0);
  expect(c.http.requests).toHaveLength(2);
  created.setOnline(false);
  expect(created.state.getState().status).toBe('offline');
  expect(sockets.every((socket) => socket.socket.state === 'closed')).toBe(true);
});

test('ENGINE-POKE: a socket revision callback kicks an immediate cycle', async () => {
  c.http.enqueue(page(), page(8));
  const { engine: created, sockets } = makeEngine({ foreground: true });
  await created.kick('start');
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('Expected a socket revision callback');
  socket.onRevision(8);
  await advance(0);
  expect(c.http.requests).toHaveLength(2);
  expect(c.kv.get('last_revision.primary')).toBe('8');
});

test('ENGINE-ARRIVE / RS-9: moving servers completes arrive before draining and replaces the socket', async () => {
  c.http.enqueue(page());
  await c.session.adopt(wireSession('reserve'), 'reserve');
  const started = deferred<void>();
  const finish = deferred<PullResult>();
  const arrive = jest.fn(async (server: Server): Promise<PullResult> => {
    c.kv.set('active_server', server);
    started.resolve();
    return finish.promise;
  });
  const { engine: created, select, sockets } = makeEngine({ arrive, foreground: true });
  await created.kick('start');
  const oldSocket = sockets.at(-1);
  const mutation = petMutation(c, 'Moved pet');
  seedMutation(c, mutation);
  c.http.enqueue(response(200, { ...mutation.localRow, revision: 11 }), page(12));
  select('reserve');
  const cycle = created.kick('refresh');
  await started.promise;
  expect(arrive).toHaveBeenCalledTimes(1);
  expect(arrive).toHaveBeenCalledWith('reserve');
  expect(created.state.getState()).toEqual({ status: 'syncing', server: 'reserve', outboxCount: 1 });
  expect(c.http.requests).toHaveLength(1);
  expect(c.outbox.count()).toBe(1);
  finish.resolve('ok');
  await cycle;
  expect(c.http.requests.slice(1).map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'POST', url: `${servers.reserve}/pets` },
    { method: 'GET', url: `${servers.reserve}/sync?since=0&limit=500` },
  ]);
  expect(oldSocket?.close).toHaveBeenCalled();
  expect(sockets.at(-1)?.server).toBe('reserve');
  expect(created.state.getState()).toEqual({ status: 'synced', server: 'reserve', outboxCount: 0 });
  expect(c.kv.get('last_revision.primary')).toBe('7');
  expect(c.kv.get('last_revision.reserve')).toBe('12');
});

test('ENGINE-NO-SERVER-SESSION / RS-9: moving to a server without tokens signs out and keeps all local intent', async () => {
  c.http.enqueue(page());
  const { engine: created, select, arrive } = makeEngine();
  await created.kick('start');
  const queued = seedMutation(c, petMutation(c, 'Kept on move'));
  const beforeStore = c.store.getState();
  const beforeReplica = c.driver.all('SELECT * FROM replica');
  const beforeOutbox = c.driver.all('SELECT * FROM outbox');
  const secrets = c.secretBox.snapshot();
  select('reserve');
  await created.kick('refresh');
  expect(arrive).toHaveBeenCalledWith('reserve');
  expect(created.state.getState()).toEqual({ status: 'signed_out', server: 'reserve', outboxCount: 1 });
  expect(c.store.getState()).toBe(beforeStore);
  expect(c.driver.all('SELECT * FROM replica')).toEqual(beforeReplica);
  expect(c.driver.all('SELECT * FROM outbox')).toEqual(beforeOutbox);
  expect(c.outbox.head(c.sessionUser.id)).toEqual(queued);
  expect(c.secretBox.snapshot()).toEqual(secrets);
  expect(c.http.requests).toHaveLength(1);
});

test('ENGINE-DISPOSE: stopping the engine clears retries and fallback and closes its socket', async () => {
  c.http.enqueue(new Error('simulated pull failure'));
  const { engine: created, sockets } = makeEngine({ foreground: true });
  await created.kick('start');
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  created.dispose();
  expect(sockets.every((socket) => socket.socket.state === 'closed')).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  await advance(180_000);
  expect(c.http.requests).toHaveLength(1);
});
