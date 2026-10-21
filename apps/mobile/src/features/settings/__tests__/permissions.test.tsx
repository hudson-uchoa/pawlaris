import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { strings } from '../../../i18n/strings';
import { PermissionsScreen } from '../PermissionsScreen';

afterEach(async () => { await cleanup(); });

test('09 §7 Permissions lists the five permission slots without requesting any permission', async () => {
  const onNotifications = jest.fn();
  await render(<PermissionsScreen active onNotifications={onNotifications} />);
  expect(screen.getByTestId('permissions-list')).toBeOnTheScreen();
  for (const permission of ['notifications', 'location', 'backgroundLocation', 'battery', 'camera'] as const) {
    expect(screen.getByTestId(`permission-${permission}`)).toHaveTextContent(strings.diagnostics[permission]);
  }
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: strings.diagnostics.notifications }));
  expect(onNotifications).toHaveBeenCalledTimes(1);
});
