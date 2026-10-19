import type { AuthUser } from '@pawlaris/shared';
import type { Lifecycle } from '../../auth/lifecycle';
import type { Logger } from '../../platform/logger';
import type { ConnectionObservable, Engine } from '../../sync/engine';
import type { SelfTestResult } from './selfTest';

export interface SettingsServices {
  sessionUser(): AuthUser;
  connection: ConnectionObservable;
  lifecycle: Pick<Lifecycle, 'logout'>;
}

export type SettingsDestination = 'family' | 'password' | 'permissions' | 'diagnostics';

export interface SettingsScreenProps {
  services: SettingsServices;
  active: boolean;
  onOpen(destination: SettingsDestination): void;
}

export interface LogShare {
  shareText(filename: string, text: string): Promise<void>;
}

export interface DiagnosticsServices {
  engine: Pick<Engine, 'state' | 'kick'>;
  logger: Pick<Logger, 'exportText'>;
  share: LogShare;
  selfTest(): SelfTestResult;
  rebuild(): Promise<void>;
}

export interface DiagnosticsScreenProps {
  services: DiagnosticsServices;
  active: boolean;
}

export interface PermissionsScreenProps {
  active: boolean;
}
