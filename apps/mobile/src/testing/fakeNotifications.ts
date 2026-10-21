import { PermissionStatus } from 'expo';
import type {
  Notification, NotificationHandler, NotificationPermissionsStatus,
  NotificationRequest, NotificationRequestInput, NotificationResponse,
} from 'expo-notifications';
import type { NotificationsPort } from '../notifications/port';

export function fakeNotifications(initial: readonly NotificationRequest[] = []) {
  const scheduled = new Map(initial.map((request) => [request.identifier, request]));
  const schedules: NotificationRequestInput[] = [];
  const cancellations: string[] = [];
  const permissionRequests: string[] = [];
  let permission: NotificationPermissionsStatus = {
    granted: false, status: PermissionStatus.DENIED, canAskAgain: true, expires: 'never',
  };
  let handler: NotificationHandler | null = null;
  let responseListener: ((response: NotificationResponse) => void) | null = null;
  const platform: NotificationsPort = {
    async getAllScheduledNotificationsAsync() { return [...scheduled.values()]; },
    async scheduleNotificationAsync(request) {
      const identifier = request.identifier;
      if (identifier === undefined) throw new Error('The app must supply a stable notification id');
      schedules.push(request);
      scheduled.set(identifier, {
        identifier, trigger: request.trigger,
        content: {
          title: request.content.title ?? null, body: request.content.body ?? null,
          subtitle: request.content.subtitle ?? null, categoryIdentifier: null,
          sound: request.content.sound === false ? null : 'default',
          data: request.content.data ?? {},
        },
      });
      return identifier;
    },
    async cancelScheduledNotificationAsync(identifier) {
      cancellations.push(identifier);
      scheduled.delete(identifier);
    },
    async setNotificationChannelAsync() { return null; },
    setNotificationHandler(next) { handler = next; },
    addNotificationResponseReceivedListener(listener) {
      responseListener = listener;
      return { remove() { responseListener = null; } };
    },
    async getPermissionsAsync() { return permission; },
    async requestPermissionsAsync() {
      permissionRequests.push('request');
      permission = { ...permission, granted: true, status: PermissionStatus.GRANTED };
      return permission;
    },
  };
  return {
    platform, scheduled, schedules, cancellations, permissionRequests,
    setPermission(granted: boolean) {
      permission = { ...permission, granted,
        status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED };
    },
    resetWrites() { schedules.length = 0; cancellations.length = 0; },
    async deliver(notification: Notification) {
      if (handler === null) throw new Error('No global notification handler was registered');
      return handler.handleNotification(notification);
    },
    respond(response: NotificationResponse) {
      if (responseListener === null) throw new Error('No notification response listener was registered');
      responseListener(response);
    },
  };
}
