import type { AuthUser } from '@pawlaris/shared';
import { AppState } from 'react-native';
import { createApi } from './api/client';
import { createAssetFiles, type AssetFiles } from './assets/files';
import { expoSecretBox, type SecretBox } from './auth/secretBox';
import { createSession, type Session } from './auth/session';
import { readServers, type Servers } from './config/servers';
import { expoSqliteDriver, type SqlDriver } from './db/driver';
import { Kv, serverKey } from './db/kv';
import { openDatabase } from './db/open';
import { createStartupMarker, type StartupMarker } from './perf/marker';
import { systemClock, type Clock } from './platform/clock';
import { expoFileSystem, getDocumentDirectory } from './platform/expoFileSystem';
import type { FileSystem } from './platform/fileSystem';
import { fetchHttp, type Http } from './platform/http';
import { cryptoIds, type IdGen } from './platform/idGen';
import { systemRandom, type Random } from './platform/random';
import { createReplicaApply } from './replica/apply';
import { hydrate } from './replica/hydrate';
import { createReplicaStore, type ReplicaStore } from './replica/store';
import type { Engine } from './sync/engine';
import { createSyncEvents, type SyncEvents } from './sync/events';
import { createOutbox, type Outbox } from './sync/outbox';
import { createServerSelect } from './sync/serverSelect';
import { createSocket, type SocketConnection } from './sync/socket';
import { createSyncEngine } from './sync/wiring';

export interface AppDependencies {
  driver: SqlDriver;
  clock: Clock;
  http: Http;
  secretBox: SecretBox;
  random: Random;
  ids: IdGen;
  fileSystem: FileSystem;
  servers: Servers;
  WebSocketImpl: new (url: string) => SocketConnection;
  online: boolean;
  perfOutput?: (message: string) => void;
  documentDirectory?: string;
}

export interface AppRuntime {
  db: SqlDriver;
  store: ReplicaStore;
  engine: Engine;
  session: Session;
  events: SyncEvents;
  clock: Clock;
  marker: StartupMarker;
  assetFiles: AssetFiles;
  sessionUser(): AuthUser | null;
  afterFirstPaint(): void;
  dispose(): void;
}

export function createAppRuntime(deps: AppDependencies): AppRuntime {
  const { driver, clock } = deps;
  openDatabase(driver);
  const kv = new Kv(driver);
  const sessionUser = (): AuthUser | null => {
    const stored = kv.get('session_user');
    return stored === null ? null : JSON.parse(stored) as AuthUser;
  };
  const store = createReplicaStore();
  const apply = createReplicaApply({ driver, clock, store });
  const serverSelect = createServerSelect({ ...deps, kv });
  const session = createSession({ ...deps, kv, activeServer: serverSelect.current });
  const api = createApi({ ...deps, session, serverSelect });
  const events = createSyncEvents();
  const marker = createStartupMarker(deps.perfOutput ?? console.log);
  if (sessionUser() !== null && kv.get(serverKey('signed_out', serverSelect.current())) !== '1') {
    hydrate({ driver, store, clock });
  }
  const assetFiles = createAssetFiles({ ...deps, store, session,
    documentDirectory: deps.documentDirectory ?? getDocumentDirectory(), activeServer: serverSelect.current,
  });
  let outbox: Outbox | null = null;
  let outboxUser: string | null = null;
  const wiring = createSyncEngine({ ...deps, store, apply, api, session, serverSelect,
    deferListeners: true, uploads: assetFiles.uploads, prefetchAvatars: assetFiles.prefetchAvatars,
    logRejectedRow: (entity, id) => { console.warn('Reseed row rejected', entity, id); },
    outbox: {
      get lastFailure() { return outbox?.lastFailure ?? null; },
      async drain() {
        const user = sessionUser();
        if (user === null) return 'signed_out';
        if (outbox === null || outboxUser !== user.id) {
          outbox = createOutbox({ ...deps, apply, api, sessionUser: user, events });
          outboxUser = user.id;
        }
        return outbox.drain();
      },
    },
    createSocket(server, onRevision) {
      const base = deps.servers[server];
      if (base === undefined) throw new Error('The active server has no configured address');
      return createSocket({ ...deps,
        url: `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`,
        session: { accessToken: () => session.accessToken(server), refresh: () => session.refresh(server) },
        lastRevision: () => Number(kv.get(serverKey('last_revision', server)) ?? 0), onRevision,
      });
    },
  });
  const { engine } = wiring;
  let painted = false;
  let disposed = false;
  return {
    db: driver, store, engine, session, events, clock, marker, assetFiles, sessionUser,
    afterFirstPaint() {
      if (painted || disposed) return;
      painted = true;
      wiring.start();
      engine.setForeground(AppState.currentState === 'active');
      void engine.kick('start');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      wiring.dispose();
    },
  };
}

export function productionDependencies(): AppDependencies {
  return {
    driver: expoSqliteDriver(), clock: systemClock, http: fetchHttp,
    secretBox: expoSecretBox(), random: systemRandom, ids: cryptoIds,
    fileSystem: expoFileSystem, documentDirectory: getDocumentDirectory(),
    servers: readServers(), WebSocketImpl: WebSocket, online: false,
  };
}
