import { AndroidImportance, type NotificationResponse } from 'expo-notifications';
import { strings } from '../../i18n/strings';
import { fakeNotifications } from '../../testing/fakeNotifications';
import { createNotificationChannels } from '../channels';
import { installNotificationHandlers } from '../handlers';
import { createExpoNotifications } from '../port';
import { scheduledRequest } from './support';

test('R3.35 startup creates the four named channels with their required importance and alerts', async () => {
  const setNotificationChannelAsync = jest.fn().mockResolvedValue(null);
  await createNotificationChannels({ setNotificationChannelAsync });
  expect(setNotificationChannelAsync.mock.calls).toEqual([
    ['reminders-critical', { name: strings.notifications.channels.critical,
      importance: AndroidImportance.HIGH, sound: 'default', enableVibrate: true }],
    ['reminders-routine', { name: strings.notifications.channels.routine, importance: AndroidImportance.DEFAULT }],
    ['timers', { name: strings.notifications.channels.timers, importance: AndroidImportance.HIGH, sound: 'default' }],
    ['family-activity', { name: strings.notifications.channels.familyActivity, importance: AndroidImportance.DEFAULT }],
  ]);
});

test('R3.32 the production notification port delegates to Expo', () => {
  expect(createExpoNotifications().scheduleNotificationAsync)
    .toBe(jest.requireActual<typeof import('expo-notifications')>('expo-notifications').scheduleNotificationAsync);
});

test.each([
  { data: { date: '2026-10-13', kind: 'health_due' }, date: '2026-10-13' },
  { data: { occurrenceKey: '2026-10-13T08:00', kind: 'reminder' }, date: '2026-10-13' },
  { data: { occurrence_key: '2026-10-13T08:00', type: 'completion' }, date: '2026-10-13' },
  { data: { type: 'completion_duplicate' }, date: undefined },
  { data: { type: 'walk_started' }, date: undefined },
])('R3.38 tapping $data routes to the occurrence day or walks', ({ data, date }) => {
  const notifications = fakeNotifications();
  const navigation = { dashboard: jest.fn(), walks: jest.fn() };
  const dispose = installNotificationHandlers({ platform: notifications.platform, navigation, showToast: jest.fn() });
  const request = scheduledRequest('notification', 'fp');
  request.content.data = data;
  notifications.respond({ actionIdentifier: 'default', notification: { request, date: 0 } });
  if (data.type === 'walk_started') {
    expect(navigation.walks).toHaveBeenCalledTimes(1);
    expect(navigation.dashboard).not.toHaveBeenCalled();
  } else expect(navigation.dashboard).toHaveBeenCalledWith(date);
  dispose();
  expect(() => notifications.respond({ actionIdentifier: 'default', notification: { request, date: 0 } }))
    .toThrow('No notification response listener');
});

test('R3.38 a tap that starts a closed app is handled on installation', () => {
  const notifications = fakeNotifications();
  const request = scheduledRequest('rem:task:2026-10-13T08:00', 'fp');
  request.content.data = { date: '2026-10-13' };
  const response: NotificationResponse = { actionIdentifier: 'default', notification: { request, date: 0 } };
  const dashboard = jest.fn();
  const dispose = installNotificationHandlers({
    platform: { ...notifications.platform, getLastNotificationResponse: () => response },
    navigation: { dashboard, walks: jest.fn() }, showToast: jest.fn(),
  });
  expect(dashboard).toHaveBeenCalledWith('2026-10-13');
  dispose();
});
