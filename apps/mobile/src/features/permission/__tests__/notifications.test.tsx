import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { strings } from '../../../i18n/strings';
import { notificationStorage } from '../../../notifications/__tests__/support';
import { createNotificationPermission, type RationaleTrigger } from '../../../notifications/permission';
import { NotificationsScreen } from '../NotificationsScreen';

const contexts: Awaited<ReturnType<typeof notificationStorage>>[] = [];

async function scene(data?: Uint8Array) {
  const c = await notificationStorage(data);
  contexts.push(c);
  const permission = createNotificationPermission({ kv: c.kv, platform: c.notifications.platform });
  return { ...c, permission };
}

afterEach(async () => {
  await cleanup();
  for (const c of contexts.splice(0)) c.driver.close();
});

test('R3.37 09 section 8.4 rationale shows once and never auto-shows after declining across a restart', async () => {
  const c = await scene();
  const onClose = jest.fn();
  const view = await render(<NotificationsScreen permission={c.permission} active onClose={onClose} />);
  expect(screen.getByText(strings.notifications.rationale)).toBeOnTheScreen();
  expect(c.notifications.permissionRequests).toEqual([]);

  await fireEvent.press(screen.getByRole('button', { name: strings.notifications.later }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(c.notifications.permissionRequests).toEqual([]);
  await view.unmount();

  const restarted = await scene(c.driver.export());
  for (const trigger of ['task_created', 'sync'] as const) {
    expect(await restarted.permission.shouldShowRationale(trigger, true)).toBe(false);
  }
  // Explicit entry from Settings remains available after automatic display stops.
  await render(<NotificationsScreen permission={restarted.permission} active onClose={onClose} />);
  expect(screen.getByText(strings.notifications.rationale)).toBeOnTheScreen();
  expect(restarted.notifications.permissionRequests).toEqual([]);
});

test.each<RationaleTrigger>(['task_created', 'sync'])(
  'R3.37 09 section 8.4 %s shows the rationale before any system request', async (trigger) => {
    const c = await scene();
    expect(await c.permission.shouldShowRationale(trigger, true)).toBe(true);
    const onClose = jest.fn();
    await render(<NotificationsScreen permission={c.permission} active onClose={onClose} />);
    expect(screen.getByText(strings.notifications.rationale)).toBeOnTheScreen();
    expect(c.notifications.permissionRequests).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: strings.notifications.activate }));
    expect(c.notifications.permissionRequests).toEqual(['request']);
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

test('R3.37 09 section 8.4 a sync without a timed template does not show the rationale', async () => {
  const c = await scene();
  expect(await c.permission.shouldShowRationale('sync', false)).toBe(false);
  expect(c.notifications.permissionRequests).toEqual([]);
});

test('R3.37 09 section 8.4 granted notifications never auto-show the rationale', async () => {
  const c = await scene();
  c.notifications.setPermission(true);
  expect(await c.permission.shouldShowRationale('task_created', true)).toBe(false);
  expect(await c.permission.shouldShowRationale('sync', true)).toBe(false);
  expect(c.notifications.permissionRequests).toEqual([]);
});
