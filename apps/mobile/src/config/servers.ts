import type { Server } from '../db/kv';

export interface Servers {
  primary: string;
  reserve?: string;
}

export function readServers(): Servers {
  throw new Error('readServers is not implemented');
}

export function activeServer(): Server {
  throw new Error('activeServer is not implemented');
}
