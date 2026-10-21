import { fakeClock } from '../../testing/fakeClock';
import { fakeNotifications } from '../../testing/fakeNotifications';
import { installNotificationHandlers } from '../handlers';
import { scheduledRequest } from './support';

const clock = fakeClock(Date.parse('2026-10-13T10:00:00Z'));

test.each([
  { id: 'rem:task:2026-10-13T08:00', kind: 'reminder' },
  { id: 'due:health', kind: 'health_due' },
  { id: 'tmr:timer', kind: 'timer' },
])('09 section 9.4 the global foreground handler shows a local $kind normally', async ({ id, kind }) => {
  const notifications = fakeNotifications();
  const showToast = jest.fn();
  const dispose = installNotificationHandlers({ platform: notifications.platform, showToast,
    navigation: { dashboard: jest.fn(), walks: jest.fn() } });
  try {
    const result = await notifications.deliver({ date: clock.now(), request: scheduledRequest(id, 'fp', kind) });
    expect(result).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
    expect(showToast).not.toHaveBeenCalled();
  } finally { dispose(); }
});

test.each([
  { code: 'R3.39', type: 'completion' },
  { code: 'R3.41', type: 'completion_duplicate' },
  { code: 'R3.42', type: 'walk_started' },
])('$code 09 section 9.4 the global foreground handler suppresses a $type push banner and shows its toast', async ({ type }) => {
  const notifications = fakeNotifications();
  const showToast = jest.fn();
  const dispose = installNotificationHandlers({ platform: notifications.platform, showToast,
    navigation: { dashboard: jest.fn(), walks: jest.fn() } });
  try {
    const request = scheduledRequest('expo-push-id', 'push');
    // 04 section 15 uses data.type for pushes, whereas locals use data.kind.
    request.content.data = type === 'walk_started'
      ? { type, walk_id: 'walk', pet_id: 'pet' }
      : { type, task_id: 'task', occurrence_key: '2026-10-13T08:00',
        pet_id: null, completion_id: 'completion' };
    request.trigger = { type: 'push' };
    const result = await notifications.deliver({ date: clock.now(), request });
    expect(result.shouldShowBanner).toBe(false);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({ title: request.content.title, body: request.content.body });
  } finally { dispose(); }
});
