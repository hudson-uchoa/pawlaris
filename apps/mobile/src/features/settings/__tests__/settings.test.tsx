import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { changePassword, PasswordChangeError } from '../../../auth/changePassword';
import { deferred, response, servers, wireSession } from '../../../auth/__tests__/support';
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

test('09 §7 Settings opens each destination without fetching', async () => {
  const c = await scene();
  await paint(c, <SettingsScreen services={c.services} active onOpen={c.onOpen} />);
  for (const destination of ['family', 'password', 'permissions', 'diagnostics']) {
    await fireEvent.press(screen.getByTestId(`settings-${destination}`));
    expect(c.onOpen).toHaveBeenLastCalledWith(destination);
  }
  expect(c.http.requests).toEqual([]);
});

test('09 §7 logout preserves pending changes until the discard sheet is confirmed', async () => {
  const c = await scene();
  c.driver.transaction(() => { c.outbox.insert(c.factory.outbox()); });
  await paint(c, <SettingsScreen services={c.services} active onOpen={c.onOpen} />);
  await fireEvent.press(screen.getByTestId('logout'));
  expect(screen.getByText(strings.settings.logoutConfirmation(1))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(1);
  expect(c.http.requests).toEqual([]);
  await fireEvent.press(screen.getByLabelText(strings.dismiss));
  expect(c.outbox.count()).toBe(1);
  expect(c.http.requests).toEqual([]);
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  await fireEvent.press(screen.getByTestId('logout'));
  c.http.enqueue(response(204));
  await fireEvent.press(screen.getByTestId('logout-confirm'));
  expect(c.outbox.count()).toBe(0);
  expect(c.kv.get('session_user')).toBeNull();
  expect(c.http.requests.map((request) => request.url)).toEqual([`${servers.primary}/auth/logout`]);
});

test('R1.12 RS-6 password availability follows connection changes while open', async () => {
  const c = await scene();
  await paint(c, <PasswordScreen services={c.services} active onClose={c.onClose} />);
  expect(screen.getByTestId('password-save')).not.toBeDisabled();
  await act(() => { c.setConnection({ status: 'offline' }); });
  expect(screen.getByTestId('offline-note')).toHaveTextContent(strings.settings.offlineNote);
  expect(screen.getByTestId('password-current')).toBeDisabled();
  await act(() => { c.setConnection({ status: 'syncing', server: 'reserve' }); });
  expect(screen.getByTestId('reserve-note')).toHaveTextContent(strings.settings.reserveNote);
  expect(screen.getByTestId('password-new')).toBeDisabled();
  await act(() => { c.setConnection({ server: 'primary' }); });
  expect(screen.getByTestId('password-save')).not.toBeDisabled();
});

test.each([7, 129])('R1.12 password rejects a new password of %i characters locally', async (length) => {
  const c = await scene();
  await paint(c, <PasswordScreen services={c.services} active onClose={c.onClose} />);
  await fireEvent.changeText(screen.getByTestId('password-current'), 'fake-current-password');
  await fireEvent.changeText(screen.getByTestId('password-new'), 'p'.repeat(length));
  await fireEvent.press(screen.getByTestId('password-save'));
  expect(screen.getByRole('alert')).toBeOnTheScreen();
  expect(c.actions.changePassword).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test('R1.12 password requires the current password and submits only once while pending', async () => {
  const c = await scene();
  const saving = deferred<void>();
  c.actions.changePassword.mockReturnValue(saving.promise);
  await paint(c, <PasswordScreen services={c.services} active onClose={c.onClose} />);
  await fireEvent.changeText(screen.getByTestId('password-new'), 'fake-new-password');
  await fireEvent.press(screen.getByTestId('password-save'));
  expect(c.actions.changePassword).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('password-current'), 'fake-current-password');
  await fireEvent.press(screen.getByTestId('password-save'));
  await fireEvent.press(screen.getByTestId('password-save'));
  expect(c.actions.changePassword).toHaveBeenCalledTimes(1);
  expect(c.actions.changePassword).toHaveBeenCalledWith('fake-current-password', 'fake-new-password');
  expect(screen.getByTestId('password-current')).toHaveProp('secureTextEntry', true);
  expect(screen.getByTestId('password-new')).toHaveProp('secureTextEntry', true);
  expect(screen.getByTestId('password-save')).toBeDisabled();
  expect(c.onClose).not.toHaveBeenCalled();
  await act(() => { saving.resolve(); });
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('password-current')).toHaveDisplayValue('');
  expect(screen.getByTestId('password-new')).toHaveDisplayValue('');
  expect(c.outbox.count()).toBe(0);
});

test('R1.12 password shows a localized current-password error and keeps the form open', async () => {
  const c = await scene();
  c.actions.changePassword.mockRejectedValue(new PasswordChangeError('invalid_credentials'));
  await paint(c, <PasswordScreen services={c.services} active onClose={c.onClose} />);
  await fireEvent.changeText(screen.getByTestId('password-current'), 'fake-current-password');
  await fireEvent.changeText(screen.getByTestId('password-new'), 'fake-new-password');
  await fireEvent.press(screen.getByTestId('password-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(strings.settings.incorrectPassword);
  expect(c.onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId('password-save')).not.toBeDisabled();
});

test('R1.12 password changes online then adopts a fresh login without touching the outbox', async () => {
  const c = await scene();
  const next = wireSession('primary', 'after-password-change');
  c.http.enqueue(response(204), response(200, next));
  await changePassword({ ...c.services, api: c.api, session: c.session },
    'fake-current-password', 'fake-new-password');
  expect(c.http.requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: 'POST', url: `${servers.primary}/me/password`,
      body: { current_password: 'fake-current-password', new_password: 'fake-new-password' } },
    { method: 'POST', url: `${servers.primary}/auth/login`,
      body: { email: c.user.email, password: 'fake-new-password' } },
  ]);
  expect(await c.session.accessToken('primary')).toBe(next.access_token);
  expect(c.outbox.count()).toBe(0);
});

test.each(['offline', 'reserve'] as const)('RS-6 the password action itself refuses %s', async (mode) => {
  const c = await scene(mode === 'offline' ? { status: 'offline' } : { server: 'reserve' });
  await expect(changePassword({ ...c.services, api: c.api, session: c.session },
    'fake-current-password', 'fake-new-password')).rejects.toMatchObject({ code: 'unavailable' });
  expect(c.http.requests).toEqual([]);
});

test('R1.12 a refused password change does not start a new login', async () => {
  const c = await scene();
  const refusal = response(401, { code: 'invalid_credentials', detail: 'Incorrect current password.' });
  c.http.enqueue(refusal, response(200, wireSession('primary', 'refreshed')), refusal);
  await expect(changePassword({ ...c.services, api: c.api, session: c.session },
    'fake-current-password', 'fake-new-password')).rejects.toMatchObject({ code: 'invalid_credentials' });
  expect(c.http.requests.map((request) => request.url)).toEqual([
    `${servers.primary}/me/password`, `${servers.primary}/auth/refresh`, `${servers.primary}/me/password`,
  ]);
  expect(c.outbox.count()).toBe(0);
});
