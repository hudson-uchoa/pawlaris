import type { SqlDriver } from './driver';

export type Server = 'primary' | 'reserve';
export type ServerKeyName =
  | 'last_revision' | 'sync_epoch' | 'reseeded_epoch' | 'signed_out' | 'push_token_sent';

export function serverKey(name: ServerKeyName, server: Server): string {
  return `${name}.${server}`;
}

export class Kv {
  constructor(private readonly driver: SqlDriver) {}

  get(key: string): string | null {
    return this.driver.all<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])[0]?.value ?? null;
  }
  set(key: string, value: string): void {
    this.driver.transaction(() => {
      this.driver.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
    });
  }
  remove(key: string): void {
    this.driver.transaction(() => {
      this.driver.run('DELETE FROM kv WHERE key = ?', [key]);
    });
  }
}
