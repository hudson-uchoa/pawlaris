import type { AuthUser, Completion } from '@pawlaris/shared';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
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
import { ReplicaRepo } from './db/replicaRepo';
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
import { createExpoNotifications, type NotificationsPort } from './notifications/port';
import { createNotificationChannels } from './notifications/channels';
import { createNotificationPermission, type NotificationPermission, type RationaleTrigger } from './notifications/permission';
import { isLocalNotification, reconcile } from './notifications/reconcile';
import { discardLocalWalk, finishLocalWalk, type LiveWalkServices } from './walks/live';
import { createPointStore } from './walks/pointStore';
import { createTracker } from './walks/tracker';
import { createWalkRecovery, type WalkRecovery } from './walks/recover';
import { WalkRepo } from './db/walkRepo';
import { createWalkRoutes, type WalkRoutes } from './walks/routes';

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
  notifications?: NotificationsPort;
}

export interface AppRuntime {
  db: SqlDriver;
  preferences: Pick<Kv, 'get' | 'set'>;
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
  readCompletionRange(from: string, to: string): readonly Completion[];
  camera: CameraDevice;
  photoCapture: PhotoCapture;
  logger: Logger;
  notifications: NotificationsPort;
  notificationPermission: NotificationPermission;
  liveWalk: LiveWalkServices;
  walkRoutes: WalkRoutes;
  walkRecovery: WalkRecovery;
  sessionUser(): AuthUser | null;
  afterFirstPaint(): void;
  dispose(): void;
}

export function createAppRuntime(deps: AppDependencies): AppRuntime {
  const { driver, clock } = deps;
  openDatabase(driver);
  const kv = new Kv(driver);
  const replica = new ReplicaRepo(driver);
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
  const notifications = deps.notifications ?? createExpoNotifications();
  const permission = createNotificationPermission({ kv, platform: notifications });
  let painted = false;
  let disposed = false;
  let reminderWork = Promise.resolve();
  const refreshReminders = (): void => {
    // Serialize native writes so a slower old plan cannot overwrite a newer one.
    reminderWork = reminderWork.then(async () => {
      if (disposed) return;
      await reconcile({ clock, kv, store, me: () => sessionUser()?.id ?? '', platform: notifications });
    }).catch(() => { void logger.write('notification_reconcile_failed', {}, 'warn'); });
  };
  const checkRationale = (trigger: RationaleTrigger): void => {
    if (disposed || !painted || sessionUser() === null) return;
    const timed = Object.values(store.getState().taskTemplates)
      .some((template) => template.deleted_at === null && template.times_of_day.length > 0);
    void permission.shouldShowRationale(trigger, timed).then((show) => {
      if (show && !disposed) events.emit('notification_rationale', undefined);
    }).catch(() => { void logger.write('notification_permission_failed', {}, 'warn'); });
  };
  const notificationPermission: NotificationPermission = { ...permission,
    async request() {
      const granted = await permission.request();
      if (granted) refreshReminders();
      return granted;
    },
  };
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
    onForeground() { refreshReminders(); checkWalkRecovery(); },
    afterAppliedChanges() { refreshReminders(); checkRationale('sync'); },
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
    async cancelNotifications() {
      await reminderWork;
      for (const request of await notifications.getAllScheduledNotificationsAsync()) {
        if (isLocalNotification(request.identifier)) {
          await notifications.cancelScheduledNotificationAsync(request.identifier);
        }
      }
    },
    stopTracking: () => liveWalk.tracker.stop(),
  });
  const mutations = createMutations({ ...deps, apply,
    sessionUser: {
      get id() {
        const user = sessionUser();
        if (user === null) throw new Error('Mutations require a session');
        return user.id;
      },
    },
    kick: (reason) => { void engine.kick(reason); },
    afterEnqueue(rows) {
      if (rows.some((row) => ['task_templates', 'task_completions', 'health_events', 'task_timers', 'pets'].includes(row.entity))) {
        refreshReminders();
      }
      if (rows.some((row) => row.entity === 'task_templates' && row.method === 'POST')) checkRationale('task_created');
    },
  });
  const points = createPointStore(driver);
  const walkRoutes = createWalkRoutes({ driver, api });
  const tracker = createTracker({ driver, kv, clock, points, mutations, location: Location,
    requestBackgroundLocation: async () => (await Location.requestBackgroundPermissionsAsync()).granted,
  });
  const localWalks = new WalkRepo(driver);
  const liveDependencies = { driver, clock, points, tracker, mutations };
  const liveWalk: LiveWalkServices = { clock, points, tracker,
    readLocalWalk: () => localWalks.getLocal(),
    finish: () => finishLocalWalk(liveDependencies),
    discard: () => discardLocalWalk(liveDependencies),
  };
  const walkRecovery = createWalkRecovery({ ...liveDependencies, location: Location });
  const checkWalkRecovery = (): void => {
    if (disposed || !painted || sessionUser() === null) return;
    void walkRecovery.recoverIfNeeded()
      .catch(() => { void logger.write('walk_recovery_failed', {}, 'warn'); });
  };
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
  if (process.env.EXPO_PUBLIC_PERF_SEED === '1') {
    // Expo inlines this flag; Metro removes the require from ordinary builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep the seed module behind the compile-time flag.
    const { seedPerformance } = require('./perf/seed') as typeof import('./perf/seed');
    diagnostics.seedPerformance = () => { seedPerformance({ driver, clock, store, mutations }); };
  }
  return {
    db: driver, preferences: kv, store, engine, session, lifecycle, events, clock, marker, assetFiles, logger, sessionUser, mutations,
    camera, photoCapture, familyActions, diagnostics, notifications, notificationPermission, liveWalk, walkRecovery, walkRoutes,
    readCompletionRange: (from, to) => replica.range('task_completions', from, to).map((record) => record.row),
    copyText: async (text) => { await Clipboard.setStringAsync(text); },
    changePassword: changeMyPassword,
    afterFirstPaint() {
      if (painted || disposed) return;
      painted = true;
      reminderWork = createNotificationChannels(notifications)
        .catch(() => { void logger.write('notification_channels_failed', {}, 'warn'); });
      refreshReminders();
      wiring.start();
      engine.setForeground(AppState.currentState === 'active');
      void engine.kick('start');
      checkWalkRecovery();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      walkRecovery.dispose();
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
