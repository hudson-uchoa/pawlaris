import type { SecretBox } from '../auth/secretBox';
import type { SqlDriver } from '../db/driver';
import type { Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { Random } from '../platform/random';
import type { Outbox } from './outbox';
import type { Pull, PullResult } from './pull';
import type { Socket } from './socket';

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
  secretBox: SecretBox;
  clock: Clock;
  random: Random;
  serverSelect: { current(): Server };
  arrive(server: Server): Promise<PullResult>;
  outbox: Pick<Outbox, 'drain'>;
  pull: Pull;
  createSocket(server: Server, onRevision: (revision: number) => void): Socket;
  online: boolean;
  foreground: boolean;
}

export function createEngine(deps: EngineDependencies): Engine {
  void deps;
  throw new Error('Engine not implemented');
}
