import type { AuthUser } from '@pawlaris/shared';
import { createLifecycle } from '../../../auth/lifecycle';
import { createDiagnosticsReader } from '../../../diagnostics';
import { createLogger, type LogFiles } from '../../../platform/logger';
import type { ConnectionObservable, ConnectionState } from '../../../sync/engine';
import { syncContext } from '../../../sync/__tests__/support';
import type { FamilyActions, FamilyServices } from '../../family/types';
import { runSelfTest } from '../selfTest';
import type { DiagnosticsServices } from '../types';

export async function settingsContext(options: {
  role?: AuthUser['role']; status?: ConnectionState['status']; server?: ConnectionState['server'];
} = {}) {
  const c = await syncContext();
  const user = { ...c.sessionUser, role: options.role ?? 'leader' };
  let state: ConnectionState = {
    status: options.status ?? 'synced', server: options.server ?? 'primary', outboxCount: 0,
  };
  const listeners = new Set<(state: ConnectionState) => void>();
  const connection: ConnectionObservable = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const family = c.factory.family({ id: user.family_id });
  const member = c.factory.members({ role: 'leader' });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('family', family);
    c.apply.applyLocalRow('members', c.factory.members({ id: user.id, role: user.role }));
    c.apply.applyLocalRow('members', member);
  });
  const lifecycle = createLifecycle({ ...c, activeServer: () => state.server, kick: jest.fn(),
    removeAssetFiles: jest.fn(async () => {}), cancelNotifications: jest.fn(async () => {}),
    stopTracking: jest.fn(async () => {}),
  });
  const actions = {
    patchFamily: jest.fn(async () => {}), invite: jest.fn(async () => {}),
    changeRole: jest.fn(async () => {}), removeMember: jest.fn(async () => {}),
    patchProfile: jest.fn(async () => {}), changePassword: jest.fn(async () => {}),
  } satisfies FamilyActions;
  const services: FamilyServices = { sessionUser: () => user, connection, lifecycle, actions };
  let activeLog = '';
  let archiveLog = '';
  const logFiles: LogFiles = {
    read: async () => activeLog, readArchive: async () => archiveLog,
    write: async (text) => { activeLog = text; },
    rotate: async () => { archiveLog = activeLog; activeLog = ''; },
  };
  const logger = createLogger(c.clock, logFiles);
  const shareText = jest.fn(async (_filename: string, _text: string) => {});
  const diagnosticServices: DiagnosticsServices = {
    engine: { state: connection, kick: jest.fn(async () => {}) },
    logger, share: { shareText }, selfTest: runSelfTest, rebuild: jest.fn(async () => {}),
    details: createDiagnosticsReader(c.driver, connection), camera: { getPermission: jest.fn(async () => true) },
    checkHealth: jest.fn(async () => true),
  };
  return { ...c, user, family, member, services, actions, logger, shareText, diagnosticServices,
    onOpen: jest.fn(), onClose: jest.fn(),
    setConnection(next: Partial<ConnectionState>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener(state));
    },
    seedLogs(active: string, archive = '') { activeLog = active; archiveLog = archive; },
    dispose() { c.driver.close(); },
  };
}

export type SettingsContext = Awaited<ReturnType<typeof settingsContext>>;
