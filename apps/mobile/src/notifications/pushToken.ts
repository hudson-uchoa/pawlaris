import type { Api } from '../api/client';
import { Kv, serverKey, type Server } from '../db/kv';
import type { NotificationsPort } from './port';

export interface PushRegistrationDependencies {
  notifications: Pick<NotificationsPort, 'getExpoPushTokenAsync'>;
  api: Pick<Api, 'request'>;
  kv: Kv;
  activeServer(): Server;
}

export async function registerPushToken({
  notifications, api, kv, activeServer,
}: PushRegistrationDependencies): Promise<void> {
  let token: string;
  try {
    token = (await notifications.getExpoPushTokenAsync()).data;
  } catch {
    return;
  }
  const server = activeServer();
  if (kv.get(serverKey('push_token_sent', server)) === token) return;
  try {
    const result = await api.request('PUT', '/me/push-token', { token });
    if ('ok' in result && result.ok) kv.set(serverKey('push_token_sent', server), token);
  } catch {
    // Push registration is best effort; the next foreground retries it.
  }
}
