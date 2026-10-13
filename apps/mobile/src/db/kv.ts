import type { SqlDriver } from './driver';

export type Server = 'primary' | 'reserve';
export type ServerKeyName =
  | 'last_revision' | 'sync_epoch' | 'reseeded_epoch' | 'signed_out' | 'push_token_sent';

export function serverKey(_name: ServerKeyName, _server: Server): string {
  throw new Error('not implemented: serverKey');
}

export class Kv {
  constructor(private readonly driver: SqlDriver) {}

  get(_key: string): string | null {
    throw new Error('not implemented: Kv.get');
  }
  set(_key: string, _value: string): void {
    throw new Error('not implemented: Kv.set');
  }
  remove(_key: string): void {
    throw new Error('not implemented: Kv.remove');
  }
}
