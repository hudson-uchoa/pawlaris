import Constants from 'expo-constants';
import { requestHttp } from './api/client';
import type { Servers } from './config/servers';
import { AssetRepo } from './db/assetRepo';
import { DeadLetterRepo } from './db/deadLetterRepo';
import type { SqlDriver } from './db/driver';
import { Kv, serverKey } from './db/kv';
import { ReplicaRepo } from './db/replicaRepo';
import { hydrateReplica, type ReplicaDependencies } from './replica/apply';
import type { Http } from './platform/http';
import type { ConnectionObservable, Engine } from './sync/engine';

export interface DiagnosticDeadLetter {
  clientMutationId: string;
  method: string;
  path: string;
  status: number;
  error: string;
  failedAt: number;
}

export interface DiagnosticsDetails {
  revision: number;
  deadLetters: DiagnosticDeadLetter[];
  pendingUploads: number;
  version: string | null;
  build: number | null;
}

export function createDiagnosticsReader(
  driver: SqlDriver, connection: ConnectionObservable,
): () => DiagnosticsDetails {
  const kv = new Kv(driver);
  const deadLetters = new DeadLetterRepo(driver);
  const assets = new AssetRepo(driver);
  return () => ({
    revision: Number(kv.get(serverKey('last_revision', connection.getState().server)) ?? 0),
    deadLetters: deadLetters.list().map(({ clientMutationId, method, path, status, error, failedAt }) =>
      ({ clientMutationId, method, path, status, error, failedAt })),
    pendingUploads: assets.list().filter((file) => file.state === 'to_upload').length,
    version: Constants.expoConfig?.version ?? null,
    build: Constants.platform?.android?.versionCode ?? Constants.expoConfig?.android?.versionCode ?? null,
  });
}

export async function checkDiagnosticsHealth(
  http: Http, servers: Servers, connection: ConnectionObservable,
): Promise<boolean> {
  const server = connection.getState().server;
  const base = servers[server];
  if (base === undefined) return false;
  const result = await requestHttp(http, {
    method: 'GET', url: `${base.replace(/\/+$/, '')}/health`, timeoutMs: 15_000,
  });
  return !('networkError' in result) && result.status === 200
    && typeof result.body === 'object' && result.body !== null
    && 'status' in result.body && result.body.status === 'ok'
    && 'role' in result.body && result.body.role === server;
}

export async function rebuildLocalData(
  deps: ReplicaDependencies & { engine: Pick<Engine, 'state' | 'kick'> },
): Promise<void> {
  // Let a pull already in flight finish before resetting its cursor.
  await deps.engine.kick('refresh');
  const { status, server } = deps.engine.state.getState();
  if (status !== 'synced' && status !== 'syncing') throw new Error('Rebuilding requires a connection');
  deps.driver.transaction(() => {
    new ReplicaRepo(deps.driver).clearSynced();
    new Kv(deps.driver).set(serverKey('last_revision', server), '0');
    hydrateReplica(deps);
  });
  await deps.engine.kick('refresh');
}
