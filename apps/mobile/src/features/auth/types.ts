import type { AuthUser } from '@pawlaris/shared';
import type { Lifecycle } from '../../auth/lifecycle';
import type { Session } from '../../auth/session';
import type { ConnectionObservable } from '../../sync/engine';

export interface AuthScreenServices {
  session: Pick<Session, 'login' | 'redeem'>;
  lifecycle: Pick<Lifecycle, 'onLogin'>;
  connection: ConnectionObservable;
  sessionUser(): AuthUser | null;
}

export type AuthScreenProps = {
  services: AuthScreenServices;
  active: boolean;
  onLayout?: () => void;
};
