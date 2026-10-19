import { cleanup, render, screen } from '@testing-library/react-native';
import { strings } from '../../../i18n/strings';
import { PermissionsScreen } from '../PermissionsScreen';

afterEach(async () => { await cleanup(); });

test('09 §7 Permissions lists the five permission slots without requesting any permission', async () => {
  await render(<PermissionsScreen active />);
  expect(screen.getByTestId('permissions-list')).toBeOnTheScreen();
  for (const permission of ['notifications', 'location', 'backgroundLocation', 'battery', 'camera'] as const) {
    expect(screen.getByTestId(`permission-${permission}`)).toHaveTextContent(strings.diagnostics[permission]);
  }
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
