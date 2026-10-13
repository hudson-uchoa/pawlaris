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

export class AssetRepo {
  constructor(private readonly driver: SqlDriver) {}

  get(_id: string): AssetFile | null {
    throw new Error('not implemented: AssetRepo.get');
  }
  upsert(_file: AssetFile): void {
    throw new Error('not implemented: AssetRepo.upsert');
  }
  list(): AssetFile[] {
    throw new Error('not implemented: AssetRepo.list');
  }
  remove(_id: string): void {
    throw new Error('not implemented: AssetRepo.remove');
  }
}
