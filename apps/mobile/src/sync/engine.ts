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
import type { ServerSelect, ServerOutcome } from './serverSelect';

export type KickReason =
  | 'start' | 'foreground' | 'online' | 'poke' | 'mutation'
  | 'refresh' | 'retry' | 'fallback' | 'probe' | 'login';

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
  serverSelect: ServerSelect;
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
  let arrivalPending = kv.get(serverKey('reseeded_epoch', server)) === null;
  let pullFailures = 0;
  let rerun = false;
  let nextReason: KickReason = 'start';
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
    manageFallback();
  };
  const endSession = (): void => {
    if (kv.get('session_user') !== null && kv.get(serverKey('signed_out', server)) !== '1') {
      kv.set(serverKey('signed_out', server), '1');
    }
    enterSignedOut();
  };
  const valid = (run: number): boolean => !disposed && generation === run;

  const manageFallback = (): void => {
    if (disposed || !foreground || !online || (state.status === 'signed_out' && server === 'primary')) {
      clearFallback();
    } else if (fallbackTimer === null) {
      fallbackTimer = setInterval(() => {
        if (server === 'reserve') void kick('probe');
        else if (socket?.state !== 'open') void kick('fallback');
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

  const cycle = async (reason: KickReason): Promise<void> => {
    const run = generation;
    if (online && foreground) await deps.serverSelect.tick();
    if (!valid(run)) return;
    const selected = deps.serverSelect.current();
    const moved = selected !== server;
    if (selected !== server) {
      closeSocket();
      socket = null;
      server = selected;
      arrivalPending = true;
    }
    if (reason === 'probe' && !moved && socket?.state === 'open') return;
    if (!moved && signedOut()) { enterSignedOut(); return; }
    if (reason === 'login') arrivalPending = true;
    if (arrivalPending && !online) { publish('offline'); return; }
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
    if (!online) {
      publish('offline');
      await deps.serverSelect.report('offline');
      return;
    }
    publish('syncing', true);
    await connectSocket();
    if (!valid(run)) return;
    const r1 = await deps.outbox.drain();
    if (r1 === 'signed_out') {
      if (!disposed) await deps.serverSelect.report(deps.outbox.lastFailure);
      if (valid(run)) endSession();
      return;
    }
    if (!valid(run)) return;
    const drainFailed = networkFailure(deps.outbox.lastFailure);
    const drainFailure = deps.outbox.lastFailure;
    if (!online) {
      publish('offline');
      await deps.serverSelect.report('offline');
      return;
    }
    const pullGen = kv.get('pull_gen');
    const r2 = await deps.pull.pull();
    // A new generation means pull delegated to arrival, even if its full pull failed.
    if (r2 !== 'ok' && (deps.pull.lastFailure === null || kv.get('pull_gen') !== pullGen)) {
      arrivalPending = true;
    }
    if (r2 === 'auth') {
      if (!disposed) await deps.serverSelect.report(deps.pull.lastFailure);
      if (valid(run)) endSession();
      return;
    }
    if (!valid(run)) return;
    if (r2 === 'ok') pullFailures = 0;
    publish(!online || drainFailed || networkFailure(deps.pull.lastFailure)
      || (r2 === 'transient' && deps.pull.lastFailure === null) ? 'offline'
      : outbox.count() > 0 ? 'syncing' : 'synced');
    if (online) scheduleRetry(r2 === 'transient');
    const outcome: ServerOutcome = !online ? 'offline'
      : drainFailed ? drainFailure : deps.pull.lastFailure ?? drainFailure;
    await deps.serverSelect.report(outcome);
    if (!valid(run)) return;
    if (deps.serverSelect.current() !== server) {
      closeSocket();
      socket = null;
      clearRetry();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void kick('retry');
      }, 0);
    }
    manageFallback();
  };

  function kick(reason: KickReason): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running !== null) {
      if (!rerun || reason !== 'probe') nextReason = reason;
      rerun = true;
      return running;
    }
    nextReason = reason;
    clearRetry();
    running = Promise.resolve().then(async () => {
      do {
        rerun = false;
        await cycle(nextReason);
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
