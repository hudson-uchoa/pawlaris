import type { Session } from '../auth/session';
import type { AuthUser } from '@pawlaris/shared';
import type { ApiFailure } from '../api/client';
import type { SqlDriver } from '../db/driver';
import { Kv, serverKey, type Server } from '../db/kv';
import { OutboxRepo } from '../db/outboxRepo';
import type { Clock } from '../platform/clock';
import type { Random } from '../platform/random';
import type { Outbox } from './outbox';
import type { Pull, PullResult } from './pull';
import type { Socket } from './socket';
import { backoff } from './backoff';

export type KickReason =
  | 'start' | 'foreground' | 'online' | 'poke' | 'mutation'
  | 'refresh' | 'retry' | 'fallback' | 'login';

export interface ConnectionState {
  status: 'synced' | 'syncing' | 'offline' | 'signed_out';
  server: Server;
  outboxCount: number;
}

export interface ConnectionObservable {
  getState(): ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): () => void;
}

export interface Engine {
  readonly state: ConnectionObservable;
  kick(reason: KickReason): Promise<void>;
  setOnline(online: boolean): void;
  setForeground(foreground: boolean): void;
  dispose(): void;
}

export interface EngineDependencies {
  driver: SqlDriver;
  session: Pick<Session, 'hasSession'>;
  clock: Clock;
  random: Random;
  serverSelect: { current(): Server };
  arrive(server: Server): Promise<PullResult>;
  outbox: Pick<Outbox, 'drain' | 'lastFailure'>;
  pull: Pull;
  createSocket(server: Server, onRevision: (revision: number) => void): Socket;
  online: boolean;
  foreground: boolean;
}

export function createEngine(deps: EngineDependencies): Engine {
  const kv = new Kv(deps.driver);
  const outbox = new OutboxRepo(deps.driver);
  let server = deps.serverSelect.current();
  let online = deps.online;
  let foreground = deps.foreground;
  let disposed = false;
  let generation = 0;
  let arrivalPending = false;
  let pullFailures = 0;
  let rerun = false;
  let running: Promise<void> | null = null;
  let socket: Socket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(state: ConnectionState) => void>();
  const signedOut = (): boolean => kv.get('session_user') === null
    || kv.get(serverKey('signed_out', server)) === '1';
  let state: ConnectionState = {
    status: signedOut() ? 'signed_out' : online ? 'syncing' : 'offline',
    server, outboxCount: outbox.count(),
  };

  const publish = (status: ConnectionState['status'], cycleStarted = false): void => {
    const next: ConnectionState = { status, server, outboxCount: outbox.count() };
    if (next.status === state.status && next.server === state.server
      && next.outboxCount === state.outboxCount && !cycleStarted) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  };
  const clearRetry = (): void => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const clearFallback = (): void => {
    if (fallbackTimer !== null) clearInterval(fallbackTimer);
    fallbackTimer = null;
  };
  const closeSocket = (): void => { socket?.close(); };
  const enterSignedOut = (): void => {
    if (state.status !== 'signed_out') generation += 1;
    publish('signed_out');
    clearRetry();
    clearFallback();
    closeSocket();
  };
  const endSession = (): void => {
    if (kv.get('session_user') !== null && kv.get(serverKey('signed_out', server)) !== '1') {
      kv.set(serverKey('signed_out', server), '1');
    }
    enterSignedOut();
  };
  const valid = (run: number): boolean => !disposed && generation === run;

  const manageFallback = (): void => {
    if (disposed || !foreground || !online || state.status === 'signed_out') {
      clearFallback();
    } else if (fallbackTimer === null) {
      fallbackTimer = setInterval(() => {
        if (socket?.state !== 'open') void kick('fallback');
      }, 60_000);
    }
  };
  const connectSocket = async (): Promise<void> => {
    if (!foreground || !online || state.status === 'signed_out') return;
    if (socket === null) {
      const socketServer = server;
      socket = deps.createSocket(server, () => {
        if (!disposed && socketServer === server && foreground && online && !signedOut()) {
          void kick('poke');
        }
      });
    }
    if (socket.state === 'closed') await socket.connect();
    manageFallback();
  };
  const networkFailure = (failure: ApiFailure | null): boolean => failure !== null
    && ('networkError' in failure || [502, 503, 504].includes(failure.status));
  const scheduleRetry = (pullFailed: boolean): void => {
    clearRetry();
    const storedUser = kv.get('session_user');
    const user = storedUser === null ? null : JSON.parse(storedUser) as AuthUser;
    const head = user === null ? null : outbox.head(user.id);
    const deadlines: number[] = [];
    if (head !== null && !arrivalPending) deadlines.push(head.nextRetryAt);
    if (pullFailed) {
      pullFailures += 1;
      deadlines.push(deps.clock.now() + backoff(pullFailures, null, deps.random));
    }
    if (deadlines.length > 0) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void kick('retry');
      }, Math.max(0, Math.min(...deadlines) - deps.clock.now()));
    }
  };

  const cycle = async (): Promise<void> => {
    const run = generation;
    const selected = deps.serverSelect.current();
    if (selected !== server) {
      closeSocket();
      socket = null;
      server = selected;
      arrivalPending = true;
    }
    if (arrivalPending) {
      publish('syncing');
      const result = await deps.arrive(server);
      if (!valid(run)) return;
      if (result === 'auth') { endSession(); return; }
      if (result !== 'ok') {
        publish('offline');
        scheduleRetry(result === 'transient');
        return;
      }
      arrivalPending = false;
    }
    if (signedOut()) { enterSignedOut(); return; }
    const hasSession = await deps.session.hasSession(server);
    if (!valid(run)) return;
    if (!hasSession) { endSession(); return; }
    if (!online) { publish('offline'); return; }
    if ((kv.get('active_server') ?? 'primary') !== server) kv.set('active_server', server);
    publish('syncing', true);
    await connectSocket();
    if (!valid(run)) return;
    const r1 = await deps.outbox.drain();
    if (!valid(run)) return;
    if (r1 === 'signed_out') { endSession(); return; }
    const drainFailed = networkFailure(deps.outbox.lastFailure);
    if (!online) { publish('offline'); return; }
    const r2 = await deps.pull.pull();
    if (!valid(run)) return;
    if (r2 === 'auth') { endSession(); return; }
    if (r2 === 'ok') pullFailures = 0;
    publish(!online || drainFailed || networkFailure(deps.pull.lastFailure)
      || (r2 === 'transient' && deps.pull.lastFailure === null) ? 'offline'
      : outbox.count() > 0 ? 'syncing' : 'synced');
    if (online) scheduleRetry(r2 === 'transient');
    manageFallback();
  };

  function kick(reason: KickReason): Promise<void> {
    void reason;
    if (disposed) return Promise.resolve();
    if (running !== null) { rerun = true; return running; }
    clearRetry();
    running = Promise.resolve().then(async () => {
      do {
        rerun = false;
        await cycle();
      } while (rerun && !disposed);
    }).finally(() => { running = null; });
    return running;
  }

  deps.driver.onTransactionEnd((committed) => {
    if (!committed || disposed) return;
    if (signedOut()) enterSignedOut();
    else publish(outbox.count() > 0 && state.status === 'synced' ? 'syncing' : state.status);
  });
  return {
    state: {
      getState: () => state,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    kick,
    setOnline(value) {
      if (disposed || online === value) return;
      online = value;
      if (online) void kick('online');
      else {
        clearRetry();
        clearFallback();
        closeSocket();
        publish(signedOut() ? 'signed_out' : 'offline');
      }
    },
    setForeground(value) {
      if (disposed || foreground === value) return;
      foreground = value;
      if (foreground) void kick('foreground');
      else { clearFallback(); closeSocket(); }
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearRetry();
      clearFallback();
      closeSocket();
      listeners.clear();
    },
  };
}
