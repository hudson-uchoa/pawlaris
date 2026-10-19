import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { PasswordScreen } from '../PasswordScreen';
import { SettingsScreen } from '../SettingsScreen';
import { settingsContext, type SettingsContext } from './support';

let context: SettingsContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene(options: Parameters<typeof settingsContext>[0] = {}) {
  const c = await settingsContext(options);
  context = c;
  return c;
}

async function paint(c: SettingsContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>{children}</ReplicaProvider>);
}

test('R7.7 Settings shows the author line and the existing Insurge signature', async () => {
  const c = await scene();
  await paint(c, <SettingsScreen services={c.services} active onOpen={c.onOpen} />);
  expect(screen.getByTestId('settings-author')).toHaveTextContent(strings.settings.author);
  expect(screen.getByTestId('powered-by')).toBeOnTheScreen();
  expect(screen.getByLabelText(`${strings.brand.poweredBy} ${strings.brand.insurge}`)).toBeOnTheScreen();
  expect(c.http.requests).toEqual([]);
});

test('R7.7 ADR-036 pressing the signature opens the Insurge address through fake Linking', async () => {
  const c = await scene();
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await paint(c, <SettingsScreen services={c.services} active onOpen={c.onOpen} />);
  expect(screen.getByRole('link')).toHaveProp('testID', 'powered-by');
  expect(openURL).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('powered-by'));
  expect(openURL).toHaveBeenCalledTimes(1);
  expect(openURL).toHaveBeenCalledWith('https://insurge.pages.dev');
});

test.each(['offline', 'reserve'] as const)(
  'R1.12 RS-6 password fields and submit are disabled with the %s note', async (mode) => {
    const c = await scene(mode === 'offline' ? { status: 'offline' } : { server: 'reserve' });
    await paint(c, <PasswordScreen services={c.services} active onClose={c.onClose} />);
    for (const id of ['password-current', 'password-new', 'password-save']) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId(mode === 'offline' ? 'offline-note' : 'reserve-note'))
      .toHaveTextContent(mode === 'offline' ? strings.settings.offlineNote : strings.settings.reserveNote);
    await fireEvent.press(screen.getByTestId('password-save'));
    expect(c.actions.changePassword).not.toHaveBeenCalled();
    expect(c.http.requests).toEqual([]);
    expect(c.outbox.count()).toBe(0);
  },
);

test.each(['offline', 'reserve'] as const)(
  'R5.14 RS-6 Settings disables the password action with the %s note', async (mode) => {
    const c = await scene(mode === 'offline' ? { status: 'offline' } : { server: 'reserve' });
    await paint(c, <SettingsScreen services={c.services} active onOpen={c.onOpen} />);
    expect(screen.getByTestId('settings-password')).toBeDisabled();
    expect(screen.getByTestId(mode === 'offline' ? 'offline-note' : 'reserve-note'))
      .toHaveTextContent(mode === 'offline' ? strings.settings.offlineNote : strings.settings.reserveNote);
    await fireEvent.press(screen.getByTestId('settings-password'));
    expect(c.onOpen).not.toHaveBeenCalled();
    if (mode === 'offline') expect(screen.getByTestId('logout')).toBeDisabled();
  },
);
