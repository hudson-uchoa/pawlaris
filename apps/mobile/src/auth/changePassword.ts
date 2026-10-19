import type { Api } from '../api/client';
import { accountAvailability } from '../features/family/accountAvailability';
import type { SettingsServices } from '../features/settings/types';
import type { Session } from './session';

export class PasswordChangeError extends Error {
  constructor(readonly code: 'invalid_credentials' | 'unavailable') {
    super(code);
  }
}

export async function changePassword(
  services: Pick<SettingsServices, 'connection' | 'sessionUser'> & {
    api: Api;
    session: Pick<Session, 'login' | 'adopt'>;
  },
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (accountAvailability('password', services.connection.getState()) !== 'available') {
    throw new PasswordChangeError('unavailable');
  }
  const email = services.sessionUser().email;
  const result = await services.api.request('POST', '/me/password', {
    current_password: currentPassword, new_password: newPassword,
  });
  if ('networkError' in result || !result.ok) {
    const code = !('networkError' in result) && result.status === 401
      && typeof result.body === 'object' && result.body !== null && 'code' in result.body
      && result.body.code === 'invalid_credentials' ? 'invalid_credentials' : 'unavailable';
    throw new PasswordChangeError(code);
  }
  const login = await services.session.login({ email, password: newPassword });
  if ('networkError' in login || !login.ok) throw new PasswordChangeError('unavailable');
  await services.session.adopt(login.body, 'primary');
}
