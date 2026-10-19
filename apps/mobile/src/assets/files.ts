import type { Asset } from '@pawlaris/shared';
import type { ApiResult } from '../api/client';
import { classify } from '../api/errors';
import type { Session } from '../auth/session';
import type { Servers } from '../config/servers';
import { AssetRepo, type AssetFile } from '../db/assetRepo';
import type { SqlDriver } from '../db/driver';
import type { Server } from '../db/kv';
import type { Clock } from '../platform/clock';
import type { FileSystem } from '../platform/fileSystem';
import type { Random } from '../platform/random';
import type { ReplicaStore } from '../replica/store';
import { backoff } from '../sync/backoff';

export interface Capture {
  id: string;
  kind: Asset['kind'];
  localUri: string;
  sha256: string;
}

export type AssetFileResult =
  | { status: 'ready'; uri: string }
  | { status: 'pending' | 'failed'; uri?: undefined };

export interface Uploads {
  kick(): Promise<void>;
  dispose(): void;
}

export interface AssetFiles {
  registerCapture(capture: Capture): void;
  readonly uploads: Uploads;
  ensureFile(id: string): Promise<AssetFileResult>;
  uploadState(id: string): AssetFile['state'] | null;
  retryUpload(id: string): void;
  prefetchAvatars(): Promise<void>;
}

export interface AssetFilesDependencies {
  driver: SqlDriver;
  store: ReplicaStore;
  fileSystem: FileSystem;
  documentDirectory: string;
  session: Pick<Session, 'accessToken' | 'refresh'>;
  servers: Servers;
  activeServer(): Server;
  clock: Clock;
  random: Random;
}

const extensions: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

export function createAssetFiles(deps: AssetFilesDependencies): AssetFiles {
  const repo = new AssetRepo(deps.driver);
  const downloads = new Map<string, Promise<AssetFileResult>>();
  let disposed = false;
  let needsKick = false;
  let rerun = false;
  let authBlocked = false;
  let running: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = (): void => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const requestFile = async (
    method: 'upload' | 'download', path: string, uri: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<ApiResult> => {
    const server = deps.activeServer();
    const base = deps.servers[server];
    if (base === undefined) throw new Error('The active server has no configured address');
    const token = await deps.session.accessToken(server);
    if (typeof token !== 'string') return token;
    const send = async (accessToken: string): Promise<ApiResult> => {
      try {
        const result = await deps.fileSystem[method](
          `${base.replace(/\/+$/, '')}${path}`, uri,
          { ...headers, Authorization: `Bearer ${accessToken}` },
        );
        return { ...result, ok: result.status >= 200 && result.status < 300 };
      } catch {
        return { networkError: true };
      }
    };
    const result = await send(token);
    if ('networkError' in result || result.status !== 401) return result;
    const refreshed = await deps.session.refresh(server);
    if ('networkError' in refreshed || !refreshed.ok) return refreshed;
    return send(refreshed.body.access_token);
  };

  const retryAfter = (result: ApiResult): number | null => {
    if ('networkError' in result || (result.status !== 429 && result.status !== 503)) return null;
    const value = Object.entries(result.headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
    if (value === undefined) return null;
    if (/^\d+$/.test(value.trim())) return Number(value) * 1_000;
    const instant = Date.parse(value);
    return Number.isNaN(instant) ? null : Math.max(0, instant - deps.clock.now());
  };

  const run = async (): Promise<void> => {
    for (const file of repo.list()) {
      if (disposed) return;
      if (file.state !== 'to_upload' || file.nextRetryAt > deps.clock.now()) continue;
      if (file.localUri === null || file.sha256 === null) {
        deps.driver.transaction(() => { repo.upsert({ ...file, state: 'failed' }); });
        continue;
      }
      const result = await requestFile('upload', `/assets/${file.id}?kind=${file.kind}`,
        file.localUri, { 'X-Content-SHA256': file.sha256 });
      if (disposed) return;
      const classification = classify(result);
      if (classification === 'auth') { authBlocked = true; return; }
      deps.driver.transaction(() => {
        if (!('networkError' in result) && (result.status === 200 || result.status === 201)) {
          repo.upsert({ ...file, state: 'uploaded' });
        } else if (classification === 'transient') {
          const attempts = file.attempts + 1;
          repo.upsert({ ...file, attempts,
            nextRetryAt: deps.clock.now() + backoff(attempts, retryAfter(result), deps.random) });
        } else {
          repo.upsert({ ...file, state: 'failed' });
        }
      });
    }
  };

  const scheduleRetry = (): void => {
    clearRetry();
    if (disposed || authBlocked) return;
    const remaining = repo.list().filter((file) => file.state === 'to_upload');
    if (remaining.length === 0) return;
    const next = Math.min(...remaining.map((file) => file.nextRetryAt));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void kick();
    }, Math.max(0, next - deps.clock.now()));
  };

  const kick = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (running !== null) { rerun = true; return running; }
    clearRetry();
    authBlocked = false;
    // Start after the caller's synchronous capture and referencing mutation.
    running = Promise.resolve().then(async () => {
      do {
        rerun = false;
        await run();
      } while (rerun && !disposed && !authBlocked);
    }).finally(() => {
      running = null;
      scheduleRetry();
    });
    return running;
  };

  deps.driver.onTransactionEnd((committed) => {
    const pending = needsKick;
    needsKick = false;
    if (committed && pending) void kick();
  });

  const loadFile = async (id: string): Promise<AssetFileResult> => {
    try {
      const local = repo.get(id);
      if (local?.localUri !== null && local?.localUri !== undefined
        && await deps.fileSystem.exists(local.localUri)) {
        return { status: 'ready', uri: local.localUri };
      }
      const asset = deps.store.getState().assets[id];
      if (asset === undefined) return { status: 'pending' };
      const extension = extensions[asset.mime];
      if (extension === undefined) return { status: 'failed' };
      const uri = `${deps.documentDirectory.replace(/\/+$/, '')}/assets/${id}.${extension}`;
      const result = await requestFile('download', `/assets/${id}/file`, uri);
      if (disposed || 'networkError' in result || !result.ok) return { status: 'failed' };
      deps.driver.transaction(() => {
        repo.upsert({ id, kind: asset.kind, localUri: uri, state: 'downloaded', sha256: null,
          attempts: 0, nextRetryAt: 0, createdAt: deps.clock.now() });
      });
      return { status: 'ready', uri };
    } catch {
      return { status: 'failed' };
    }
  };

  const ensureFile = (id: string): Promise<AssetFileResult> => {
    const existing = downloads.get(id);
    if (existing !== undefined) return existing;
    const pending = loadFile(id).finally(() => { downloads.delete(id); });
    downloads.set(id, pending);
    return pending;
  };

  return {
    registerCapture(capture) {
      deps.driver.transaction(() => {
        repo.upsert({ ...capture, state: 'to_upload', attempts: 0,
          nextRetryAt: 0, createdAt: deps.clock.now() });
        needsKick = true;
      });
    },
    uploads: {
      kick,
      dispose() { disposed = true; clearRetry(); },
    },
    ensureFile,
    uploadState(_id) {
      throw new Error('not implemented');
    },
    retryUpload(id) {
      deps.driver.transaction(() => {
        const file = repo.get(id);
        if (file === null || file.state !== 'failed') return;
        repo.upsert({ ...file, state: 'to_upload', attempts: 0, nextRetryAt: 0 });
        needsKick = true;
      });
    },
    async prefetchAvatars() {
      const ids = new Set(Object.values(deps.store.getState().pets)
        .flatMap((pet) => pet.archived_at !== null || pet.avatar_asset_id === null
          ? [] : [pet.avatar_asset_id]));
      await Promise.all([...ids].map(ensureFile));
    },
  };
}
