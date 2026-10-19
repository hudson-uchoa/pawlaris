import type { AuthUser } from '@pawlaris/shared';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { createApi } from './api/client';
import { createAssetFiles, type AssetFiles } from './assets/files';
import { createLifecycle, type Lifecycle } from './auth/lifecycle';
import { changePassword } from './auth/changePassword';
import { createFamilyActions } from './auth/familyActions';
import { expoSecretBox, type SecretBox } from './auth/secretBox';
import { createSession, type Session } from './auth/session';
import { readServers, type Servers } from './config/servers';
import { expoSqliteDriver, type SqlDriver } from './db/driver';
import { Kv, serverKey } from './db/kv';
import { openDatabase } from './db/open';
import { checkDiagnosticsHealth, createDiagnosticsReader, rebuildLocalData } from './diagnostics';
import type { FamilyActions } from './features/family/types';
import { runSelfTest } from './features/settings/selfTest';
import type { DiagnosticsServices, LogShare } from './features/settings/types';
import { createStartupMarker, type StartupMarker } from './perf/marker';
import { systemClock, type Clock } from './platform/clock';
import { createExpoCamera, type CameraDevice } from './platform/camera';
import { createPhotoCapture, type PhotoCapture } from './features/pets/capture';
import { expoFileSystem, getDocumentDirectory } from './platform/expoFileSystem';
import type { FileSystem } from './platform/fileSystem';
import { fetchHttp, type Http } from './platform/http';
import { cryptoIds, type IdGen } from './platform/idGen';
import { createExpoLogFiles, createLogger, type LogFiles, type Logger } from './platform/logger';
import { systemRandom, type Random } from './platform/random';
import { createExpoLogShare } from './platform/logShare';
import { createReplicaApply } from './replica/apply';
import { hydrate } from './replica/hydrate';
import { createReplicaStore, type ReplicaStore } from './replica/store';
import type { Engine } from './sync/engine';
import { createSyncEvents, type SyncEvents } from './sync/events';
import { createMutations, type Mutations } from './sync/mutations';
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
  logFiles?: LogFiles;
  camera?: CameraDevice;
  logShare?: LogShare;
}

export interface AppRuntime {
  db: SqlDriver;
  store: ReplicaStore;
  engine: Engine;
  session: Session;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  familyActions: FamilyActions;
  copyText(text: string): Promise<void>;
  diagnostics: DiagnosticsServices;
  lifecycle: Lifecycle;
  events: SyncEvents;
  clock: Clock;
  marker: StartupMarker;
  assetFiles: AssetFiles;
  readonly mutations: Mutations;
  camera: CameraDevice;
  photoCapture: PhotoCapture;
  logger: Logger;
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
  const documentDirectory = deps.documentDirectory ?? getDocumentDirectory();
  const logger = createLogger(clock, deps.logFiles ?? createExpoLogFiles(documentDirectory));
  if (sessionUser() !== null && kv.get(serverKey('signed_out', serverSelect.current())) !== '1') {
    hydrate({ driver, store, clock });
  }
  const assetFiles = createAssetFiles({ ...deps, store, session,
    documentDirectory, activeServer: serverSelect.current,
  });
  const camera = deps.camera ?? createExpoCamera(documentDirectory);
  const photoCapture = createPhotoCapture(camera, assetFiles, deps.ids);
  let outbox: Outbox | null = null;
  let outboxUser: string | null = null;
  const wiring = createSyncEngine({ ...deps, store, apply, api, session, serverSelect,
    deferListeners: true, uploads: assetFiles.uploads, prefetchAvatars: assetFiles.prefetchAvatars,
    logRejectedRow: (entity, id) => { void logger.write('reseed_row_rejected', { entity, id }, 'warn'); },
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
  const lifecycle = createLifecycle({ ...deps, store, session, api,
    activeServer: serverSelect.current, kick: (reason) => engine.kick(reason),
    removeAssetFiles: () => deps.fileSystem.remove(`${documentDirectory.replace(/\/+$/, '')}/assets`),
    // No reminders or location tracking exist until P5-7 and P6-2.
    cancelNotifications: async () => {}, stopTracking: async () => {},
  });
  let painted = false;
  let disposed = false;
  const mutations = createMutations({ ...deps, apply,
    sessionUser: {
      get id() {
        const user = sessionUser();
        if (user === null) throw new Error('Mutations require a session');
        return user.id;
      },
    },
    kick: (reason) => { void engine.kick(reason); },
  });
  const changeMyPassword: FamilyActions['changePassword'] = (currentPassword, newPassword) => changePassword({
    api, session, connection: engine.state,
    sessionUser: () => {
      const user = sessionUser();
      if (user === null) throw new Error('Password changes require a session');
      return user;
    },
  }, currentPassword, newPassword);
  const familyActions = createFamilyActions({ ...deps, api, apply, store, sessionUser,
    connection: engine.state, kick: engine.kick, changePassword: changeMyPassword });
  const diagnostics: DiagnosticsServices = {
    engine, logger, camera, share: deps.logShare ?? createExpoLogShare(),
    details: createDiagnosticsReader(driver, engine.state), selfTest: runSelfTest,
    checkHealth: () => checkDiagnosticsHealth(deps.http, deps.servers, engine.state),
    rebuild: () => rebuildLocalData({ driver, store, clock, engine }),
  };
  return {
    db: driver, store, engine, session, lifecycle, events, clock, marker, assetFiles, logger, sessionUser, mutations,
    camera, photoCapture, familyActions, diagnostics,
    copyText: async (text) => { await Clipboard.setStringAsync(text); },
    changePassword: changeMyPassword,
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
