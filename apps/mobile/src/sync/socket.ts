import type { Session } from '../auth/session';
import type { Clock } from '../platform/clock';
import type { Random } from '../platform/random';

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

export function createSocket(dependencies: SocketDependencies): Socket {
  void dependencies;
  return {
    get state(): SocketState { throw new Error('not implemented'); },
    async connect(): Promise<void> { throw new Error('not implemented'); },
    close(): void { throw new Error('not implemented'); },
  };
}
