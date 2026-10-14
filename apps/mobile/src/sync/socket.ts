import type { Session } from '../auth/session';
import type { Clock } from '../platform/clock';
import type { Random } from '../platform/random';
import { backoff } from './backoff';

export type SocketState = 'closed' | 'connecting' | 'open';

export type SocketConnection = Pick<WebSocket,
  'onopen' | 'onmessage' | 'onerror' | 'onclose' | 'send' | 'close'>;

export interface SocketDependencies {
  url: string;
  session: Pick<Session, 'accessToken' | 'refresh'>;
  clock: Clock;
  random: Random;
  WebSocketImpl: new (url: string) => SocketConnection;
  lastRevision(): number;
  onRevision(revision: number): void;
}

export interface Socket {
  readonly state: SocketState;
  connect(): Promise<void>;
  close(): void;
}

export function createSocket({
  url, session, random, WebSocketImpl, lastRevision, onRevision,
}: SocketDependencies): Socket {
  let state: SocketState = 'closed';
  let wanted = false;
  let generation = 0;
  let attempts = 0;
  let connection: SocketConnection | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const active = (run: number): boolean => wanted && generation === run;

  const stopTransport = (closeTransport = true): void => {
    if (pingTimer !== null) clearInterval(pingTimer);
    if (pongTimer !== null) clearTimeout(pongTimer);
    pingTimer = null;
    pongTimer = null;
    const previous = connection;
    connection = null;
    state = 'closed';
    if (previous === null) return;
    previous.onopen = null;
    previous.onmessage = null;
    previous.onerror = null;
    previous.onclose = null;
    if (closeTransport) previous.close();
  };

  const retry = (run: number, operation: (run: number) => Promise<void>): void => {
    const delay = backoff(attempts, null, random);
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void operation(run);
    }, delay);
  };

  const refresh = async (run: number): Promise<void> => {
    const result = await session.refresh();
    if (!active(run)) return;
    if ('networkError' in result) retry(run, refresh);
    else if (result.ok) await start(run);
    else wanted = false;
  };

  const start = async (run: number): Promise<void> => {
    state = 'connecting';
    const token = await session.accessToken();
    if (!active(run)) return;
    if (typeof token !== 'string') {
      state = 'closed';
      if ('networkError' in token) retry(run, start);
      else wanted = false;
      return;
    }

    let wire: SocketConnection;
    try { wire = new WebSocketImpl(url); }
    catch {
      state = 'closed';
      retry(run, start);
      return;
    }
    connection = wire;
    const current = (): boolean => active(run) && connection === wire;
    const reconnect = (): void => {
      if (!current()) return;
      stopTransport();
      retry(run, start);
    };
    const send = (frame: { type: 'ping' } | { type: 'auth'; access_token: string }): boolean => {
      try { wire.send(JSON.stringify(frame)); return true; }
      catch { reconnect(); return false; }
    };

    wire.onopen = () => {
      if (!current()) return;
      state = 'open';
      if (!send({ type: 'auth', access_token: token }) || !current()) return;
      pingTimer = setInterval(() => {
        pongTimer = setTimeout(reconnect, 10_000);
        send({ type: 'ping' });
      }, 30_000);
    };
    wire.onmessage = (event) => {
      if (!current()) return;
      const frame = JSON.parse(event.data as string) as {
        type: 'ready' | 'poke' | 'pong'; revision: number;
      };
      if (frame.type !== 'ready' && frame.type !== 'poke' && frame.type !== 'pong') return;
      if (frame.type === 'ready') attempts = 0;
      if (frame.type === 'pong') {
        if (pongTimer !== null) clearTimeout(pongTimer);
        pongTimer = null;
      }
      if (frame.revision > lastRevision()) onRevision(frame.revision);
    };
    wire.onerror = reconnect;
    wire.onclose = (event) => {
      if (!current()) return;
      stopTransport(false);
      if (event.code === 4401) void refresh(run);
      else retry(run, start);
    };
  };

  return {
    get state(): SocketState { return state; },
    async connect(): Promise<void> {
      if (wanted) return;
      wanted = true;
      await start(generation);
    },
    close(): void {
      wanted = false;
      generation += 1;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      stopTransport();
    },
  };
}
