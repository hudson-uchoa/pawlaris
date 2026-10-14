import type { Asset } from '@pawlaris/shared';
import type { SqlDriver } from './driver';

export interface AssetFile {
  id: string;
  kind: Asset['kind'];
  localUri: string | null;
  state: 'to_upload' | 'uploaded' | 'downloaded' | 'failed';
  sha256: string | null;
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
}

const columns = `
  id, kind, local_uri AS localUri, state, sha256, attempts,
  next_retry_at AS nextRetryAt, created_at AS createdAt
`;

export class AssetRepo {
  constructor(private readonly driver: SqlDriver) {}

  get(id: string): AssetFile | null {
    return this.driver.all<AssetFile>(
      `SELECT ${columns} FROM asset_file WHERE id = ?`, [id],
    )[0] ?? null;
  }
  upsert(file: AssetFile): void {
    this.driver.run(`
      INSERT OR REPLACE INTO asset_file (
        id, kind, local_uri, state, sha256, attempts, next_retry_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [file.id, file.kind, file.localUri, file.state, file.sha256,
      file.attempts, file.nextRetryAt, file.createdAt]);
  }
  list(): AssetFile[] {
    return this.driver.all<AssetFile>(`
      SELECT ${columns} FROM asset_file ORDER BY created_at, id
    `);
  }
  remove(id: string): void {
    this.driver.run('DELETE FROM asset_file WHERE id = ?', [id]);
  }
}
