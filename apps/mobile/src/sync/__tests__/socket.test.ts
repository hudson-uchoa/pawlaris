import { deferred, sessionContext, response, wireSession, type SessionContext } from '../../auth/__tests__/support';
import { createSession } from '../../auth/session';
import type { HttpResponse } from '../../platform/http';
import { fakeRandom } from '../../testing/fakeRandom';
import { fakeWebSocket } from '../../testing/fakeWebSocket';
import { createSocket, type Socket } from '../socket';

const url = 'wss://primary.pawlaris.invalid/ws';
let c: SessionContext;
let transport: ReturnType<typeof fakeWebSocket>;
let socket: Socket;
let onRevision: jest.Mock<void, [number]>;

beforeEach(async () => {
  c = await sessionContext();
  jest.useFakeTimers();
  transport = fakeWebSocket();
  onRevision = jest.fn<void, [number]>();
  c.kv.set('last_revision.primary', '10');
  await c.makeSession().adopt(wireSession('primary'));
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  c.driver.close();
});

function makeSocket(...jitter: number[]) {
  const session = c.makeSession();
  socket = createSocket({
    url, session, clock: c.clock, random: fakeRandom(...jitter),
    WebSocketImpl: transport.WebSocketImpl,
    lastRevision: () => Number(c.kv.get('last_revision.primary') ?? 0),
    onRevision,
  });
  return session;
}

function connection(index = transport.instances.length - 1) {
  const instance = transport.instances[index];
  if (instance === undefined) throw new Error('Expected a socket connection');
  return instance;
}

async function advance(milliseconds: number) {
  c.clock.advance(milliseconds);
  await jest.advanceTimersByTimeAsync(milliseconds);
}

async function openSocket() {
  await socket.connect();
  connection().open();
  await advance(0);
  return connection();
}

test('WS-1: the fake transport delivers frames and records client sends and closes', () => {
  const wire = new transport.WebSocketImpl(url);
  const opened = jest.fn();
  const received = jest.fn();
  const closed = jest.fn();
  const failed = jest.fn();
  wire.onopen = opened;
  wire.onmessage = received;
  wire.onclose = closed;
  wire.onerror = failed;
  wire.open();
  wire.send(JSON.stringify({ type: 'ping' }));
  wire.receive({ type: 'pong', revision: 11 });
  wire.error();
  wire.close();
  expect(opened).toHaveBeenCalledTimes(1);
  expect(received).toHaveBeenCalledWith(expect.objectContaining({ data: '{"type":"pong","revision":11}' }));
  expect(failed).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 1000 }));
  expect(wire.sent).toEqual(['{"type":"ping"}']);
  expect(wire.closes).toEqual([{ code: 1000, reason: '' }]);
  expect(wire.readyState).toBe(3);
});

test('WS-1: the fake transport rejects sending before open and after close', () => {
  const wire = new transport.WebSocketImpl(url);
  expect(() => wire.send('{}')).toThrow('Fake socket is not open');
  wire.open();
  wire.serverClose();
  expect(() => wire.send('{}')).toThrow('Fake socket is not open');
});

test('WS-1: state starts closed, becomes connecting, then open, then closed', async () => {
  makeSocket();
  expect(socket.state).toBe('closed');
  await socket.connect();
  expect(socket.state).toBe('connecting');
  connection().open();
  await advance(0);
  expect(socket.state).toBe('open');
  socket.close();
  expect(socket.state).toBe('closed');
});

test('WS-1: the first frame authenticates within five seconds and the token never enters the URL', async () => {
  makeSocket();
  const wire = await openSocket();
  expect(wire.url).toBe(url);
  expect(wire.url).not.toContain(wireSession('primary').access_token);
  expect(wire.sent).toEqual([JSON.stringify({
    type: 'auth', access_token: wireSession('primary').access_token,
  })]);
  await advance(4_999);
  expect(wire.sent).toHaveLength(1);
});

test.each(['ready', 'poke', 'pong'] as const)(
  'WS-1: %s calls onRevision once for a newer revision and never for equal or lower revisions', async (type) => {
    makeSocket();
    const wire = await openSocket();
    wire.receive({ type, revision: 10 });
    wire.receive({ type, revision: 9 });
    expect(onRevision).not.toHaveBeenCalled();
    wire.receive({ type, revision: 11 });
    expect(onRevision.mock.calls).toEqual([[11]]);
    c.kv.set('last_revision.primary', '11');
    wire.receive({ type, revision: 11 });
    wire.receive({ type, revision: 10 });
    expect(onRevision.mock.calls).toEqual([[11]]);
    wire.receive({ type, revision: 12 });
    expect(onRevision.mock.calls).toEqual([[11], [12]]);
    expect(c.kv.get('last_revision.primary')).toBe('11');
  },
);

test('WS-1: reconnection ready detects a revision advanced while the socket was disconnected', async () => {
  makeSocket(0);
  const wire = await openSocket();
  wire.receive({ type: 'ready', revision: 10 });
  wire.serverClose();
  await advance(500);
  connection().open();
  await advance(0);
  connection().receive({ type: 'ready', revision: 17 });
  expect(onRevision.mock.calls).toEqual([[17]]);
});

test('WS-1: a ping is sent every thirty seconds and timely pongs keep the connection open', async () => {
  makeSocket();
  const wire = await openSocket();
  wire.receive({ type: 'ready', revision: 10 });
  for (let count = 1; count <= 3; count += 1) {
    await advance(29_999);
    expect(wire.sent).toHaveLength(count);
    await advance(1);
    expect(JSON.parse(wire.sent[count] ?? 'null')).toEqual({ type: 'ping' });
    wire.receive({ type: 'pong', revision: 10 });
  }
  await advance(10_000);
  expect(wire.closes).toEqual([]);
  expect(transport.instances).toHaveLength(1);
  expect(socket.state).toBe('open');
});

test('WS-1: a missing pong closes at ten seconds and reconnects with backoff', async () => {
  makeSocket(0);
  const wire = await openSocket();
  wire.receive({ type: 'ready', revision: 10 });
  await advance(30_000);
  await advance(9_999);
  expect(wire.closes).toHaveLength(0);
  await advance(1);
  expect(wire.closes).toHaveLength(1);
  expect(socket.state).toBe('closed');
  await advance(499);
  expect(transport.instances).toHaveLength(1);
  await advance(1);
  expect(transport.instances).toHaveLength(2);
});

test('WS-1: a poke during the pong deadline cannot keep a dead connection alive', async () => {
  makeSocket(0);
  const wire = await openSocket();
  await advance(30_000);
  await advance(9_000);
  wire.receive({ type: 'poke', revision: 12 });
  await advance(1_000);
  expect(wire.closes).toHaveLength(1);
  expect(onRevision.mock.calls).toEqual([[12]]);
  await advance(500);
  expect(transport.instances).toHaveLength(2);
});

test('WS-1: an equal-revision pong clears its deadline and the next ping gets a new deadline', async () => {
  makeSocket(0);
  const wire = await openSocket();
  await advance(39_999);
  wire.receive({ type: 'pong', revision: 10 });
  await advance(1);
  expect(wire.closes).toHaveLength(0);
  expect(onRevision).not.toHaveBeenCalled();
  await advance(20_000);
  await advance(9_999);
  expect(wire.closes).toHaveLength(0);
  await advance(1);
  expect(wire.closes).toHaveLength(1);
});

test('WS-1: close 4401 joins a single-flight refresh then authenticates with the new token', async () => {
  const session = makeSocket();
  const wire = await openSocket();
  const refreshed = deferred<HttpResponse>();
  c.http.enqueue(() => refreshed.promise);
  const concurrent = session.refresh();
  wire.serverClose(4401);
  await advance(0);
  expect(c.http.requests).toHaveLength(1);
  expect(transport.instances).toHaveLength(1);
  expect(socket.state).toBe('closed');
  const rotated = wireSession('primary', 'rotated');
  refreshed.resolve(response(200, rotated));
  await concurrent;
  await advance(0);
  expect(c.http.requests).toHaveLength(1);
  expect(transport.instances).toHaveLength(2);
  connection().open();
  await advance(0);
  expect(connection().sent).toEqual([JSON.stringify({ type: 'auth', access_token: rotated.access_token })]);
  expect(connection().url).toBe(url);
});

test('WS-1: a network-failed 4401 refresh retries after growing backoff before reconnecting', async () => {
  makeSocket(0, 0.5);
  const wire = await openSocket();
  c.http.enqueue(new Error('simulated network failure'), new Error('simulated network failure'),
    response(200, wireSession('primary', 'recovered')));
  wire.serverClose(4401);
  await advance(0);
  expect(c.http.requests).toHaveLength(1);
  await advance(499);
  expect(c.http.requests).toHaveLength(1);
  await advance(1);
  expect(c.http.requests).toHaveLength(2);
  expect(transport.instances).toHaveLength(1);
  await advance(1_499);
  expect(c.http.requests).toHaveLength(2);
  await advance(1);
  expect(c.http.requests).toHaveLength(3);
  expect(transport.instances).toHaveLength(2);
  connection().open();
  await advance(0);
  expect(connection().sent).toEqual([JSON.stringify({
    type: 'auth', access_token: wireSession('primary', 'recovered').access_token,
  })]);
});

test('WS-1: a 4401 refresh answered 401 leaves the socket closed with no retries', async () => {
  makeSocket();
  const wire = await openSocket();
  c.http.enqueue(response(401));
  wire.serverClose(4401);
  await advance(120_000);
  expect(c.http.requests).toHaveLength(1);
  expect(transport.instances).toHaveLength(1);
  expect(socket.state).toBe('closed');
  expect(jest.getTimerCount()).toBe(0);
});

test.each([1000, 1006, 4408, 'error'] as const)(
  'WS-1: %s reconnects after the exact injected jitter without refreshing', async (failure) => {
    makeSocket(0.5);
    const wire = await openSocket();
    if (failure === 'error') wire.error();
    else wire.serverClose(failure);
    await advance(749);
    expect(transport.instances).toHaveLength(1);
    await advance(1);
    expect(transport.instances).toHaveLength(2);
    expect(c.http.requests).toHaveLength(0);
    connection().open();
    await advance(0);
    expect(connection().sent).toEqual([JSON.stringify({
      type: 'auth', access_token: wireSession('primary').access_token,
    })]);
  },
);

test('WS-1: repeated disconnects grow backoff, cap it at sixty seconds, and reset on ready', async () => {
  makeSocket(...Array.from({ length: 9 }, () => 0.5));
  await openSocket();
  for (const delay of [750, 1_500, 3_000, 6_000, 12_000, 24_000, 45_000, 45_000]) {
    const count = transport.instances.length;
    connection().serverClose();
    await advance(delay - 1);
    expect(transport.instances).toHaveLength(count);
    await advance(1);
    expect(transport.instances).toHaveLength(count + 1);
    connection().open();
    await advance(0);
  }
  connection().receive({ type: 'ready', revision: 10 });
  const count = transport.instances.length;
  connection().serverClose();
  await advance(749);
  expect(transport.instances).toHaveLength(count);
  await advance(1);
  expect(transport.instances).toHaveLength(count + 1);
});

test('WS-1: an error followed by its close event schedules only one reconnection', async () => {
  makeSocket(0);
  const wire = await openSocket();
  wire.error();
  wire.serverClose();
  await advance(500);
  expect(transport.instances).toHaveLength(2);
});

test.each(['open', 'pong deadline', 'reconnect'] as const)(
  'WS-1: close stops every timer and reconnection while waiting for %s', async (phase) => {
    makeSocket(0);
    const wire = await openSocket();
    if (phase === 'pong deadline') await advance(30_000);
    if (phase === 'reconnect') wire.serverClose();
    const sent = [...wire.sent];
    socket.close();
    expect(socket.state).toBe('closed');
    expect(wire.readyState).toBe(3);
    expect(jest.getTimerCount()).toBe(0);
    await advance(180_000);
    expect(wire.sent).toEqual(sent);
    expect(transport.instances).toHaveLength(1);
    expect(onRevision).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('WS-1: close during a network refresh retry cancels the retry timer', async () => {
  makeSocket(0);
  const wire = await openSocket();
  c.http.enqueue(new Error('simulated network failure'));
  wire.serverClose(4401);
  await advance(0);
  expect(c.http.requests).toHaveLength(1);
  socket.close();
  expect(jest.getTimerCount()).toBe(0);
  await advance(180_000);
  expect(c.http.requests).toHaveLength(1);
  expect(transport.instances).toHaveLength(1);
});

test.each([200, 'network'] as const)(
  'WS-1: close during an in-flight refresh prevents later %s from restarting the socket', async (result) => {
    makeSocket();
    const wire = await openSocket();
    const refreshed = deferred<HttpResponse>();
    c.http.enqueue(async () => {
      const reply = await refreshed.promise;
      if (result === 'network') throw new Error('simulated network failure');
      return reply;
    });
    wire.serverClose(4401);
    await advance(0);
    expect(c.http.requests).toHaveLength(1);
    socket.close();
    refreshed.resolve(response(200, wireSession('primary', 'rotated')));
    await advance(180_000);
    expect(socket.state).toBe('closed');
    expect(transport.instances).toHaveLength(1);
    expect(c.http.requests).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('WS-1: close while connecting closes the transport and clears all work', async () => {
  makeSocket();
  await socket.connect();
  const wire = connection();
  socket.close();
  expect(wire.readyState).toBe(3);
  await advance(180_000);
  expect(wire.sent).toEqual([]);
  expect(socket.state).toBe('closed');
  expect(transport.instances).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('WS-1: close during token lookup prevents opening a transport after the lookup completes', async () => {
  const lookup = deferred<string | null>();
  const values = new Map(Object.entries(c.secretBox.snapshot()));
  const session = createSession({
    ...c,
    secretBox: {
      get: () => lookup.promise,
      async set(key, value) { values.set(key, value); },
      async del(key) { values.delete(key); },
    },
  });
  socket = createSocket({
    url, session, clock: c.clock, random: fakeRandom(),
    WebSocketImpl: transport.WebSocketImpl, lastRevision: () => 10, onRevision,
  });
  const connecting = socket.connect().then(() => 'connected', (error: unknown) => error);
  socket.close();
  lookup.resolve(values.get('session_tokens.primary') ?? null);
  expect(await connecting).toBe('connected');
  await advance(180_000);
  expect(socket.state).toBe('closed');
  expect(transport.instances).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('WS-1: late transport events after close trigger neither revisions nor reconnections', async () => {
  makeSocket();
  const wire = await openSocket();
  const receive = wire.onmessage;
  const error = wire.onerror;
  const closed = wire.onclose;
  socket.close();
  receive?.(new MessageEvent('message', { data: JSON.stringify({ type: 'poke', revision: 99 }) }));
  error?.(new Event('error'));
  closed?.(Object.assign(new Event('close'), { code: 4401, reason: '', wasClean: false }));
  await advance(180_000);
  expect(onRevision).not.toHaveBeenCalled();
  expect(c.http.requests).toHaveLength(0);
  expect(transport.instances).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});
