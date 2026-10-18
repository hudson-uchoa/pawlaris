import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import { response, servers, wireSession } from '../../../auth/__tests__/support';
import { strings } from '../../../i18n/strings';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { LoginScreen } from '../LoginScreen';
import { authContext, credentials, type AuthContext } from './support';

const initialAppState = AppState.currentState;
let context: AuthContext | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene(options: Parameters<typeof authContext>[0] = {}) {
  const c = await authContext(options);
  context = c;
  const onRedeem = jest.fn();
  const onLayout = jest.fn();
  const view = await render(<LoginScreen services={c.services} active onRedeem={onRedeem} onLayout={onLayout} />);
  return { ...c, view, onRedeem, onLayout };
}

async function submit(email = credentials.email) {
  await fireEvent.changeText(screen.getByTestId('login-email'), email);
  await fireEvent.changeText(screen.getByTestId('login-password'), credentials.password);
  await fireEvent.press(screen.getByTestId('login-submit'));
}

test('R5.1 login paints its form and invite link without HTTP or an entry spinner', async () => {
  const c = await scene();
  expect(screen.getByText(strings.appName)).toBeOnTheScreen();
  expect(screen.getByTestId('login-email')).toBeOnTheScreen();
  expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(true);
  expect(screen.getByTestId('login-submit')).not.toBeBusy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(c.http.requests).toEqual([]);
  await fireEvent.press(screen.getByTestId('login-to-redeem'));
  expect(c.onRedeem).toHaveBeenCalledTimes(1);
});

test('R7.7 login shows the accessible Insurge signature without a press action', async () => {
  await scene();
  const signature = screen.getByTestId('powered-by');
  const label = `${strings.brand.poweredBy} ${strings.brand.insurge}`;
  expect(signature).toBeOnTheScreen();
  expect(signature.props.accessibilityLabel).toBe(label);
  expect(signature.props.onPress).toBeUndefined();
  expect(screen.queryByRole('link', { name: label })).toBeNull();
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  await fireEvent.press(signature);
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test.each([
  { code: 'R1.5 wrong credentials', reply: response(401, { detail: 'Never display this detail.' }), message: strings.auth.invalidCredentials },
  { code: 'R1.5 Retry-After seconds', reply: { ...response(429), headers: { 'Retry-After': '120' } }, message: strings.auth.rateLimited(2) },
  { code: 'R5.1 unavailable network', reply: new Error('Simulated offline transport'), message: strings.auth.networkError },
])('$code shows the specified error under the visible form', async ({ reply, message }) => {
  const c = await scene();
  c.http.enqueue(reply);
  await submit();
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]).toMatchObject({ method: 'POST', url: `${servers.primary}/auth/login`, body: credentials });
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByText('Never display this detail.')).toBeNull();
  expect(screen.getByTestId('login-email')).toBeOnTheScreen();
  expect(screen.getByTestId('login-submit')).not.toBeBusy();
  expect(c.kv.get('session_user')).toBeNull();
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.kick).not.toHaveBeenCalled();
});

test('R5.1 a pending login keeps the form visible and makes only the submit button busy', async () => {
  const c = await scene();
  const reply = c.pendingReply();
  c.http.enqueue(() => reply.promise);
  await submit();
  const button = screen.getByTestId('login-submit');
  expect(button).toBeBusy();
  expect(button).toBeDisabled();
  expect(screen.getByTestId('login-email')).toBeOnTheScreen();
  expect(screen.getByTestId('login-password')).toBeOnTheScreen();
  await fireEvent.press(button);
  expect(c.http.requests).toHaveLength(1);
  await act(() => { reply.resolve(response(401)); });
  expect(screen.getByTestId('login-submit')).not.toBeBusy();
});

test('R1.5 missing or invalid Retry-After falls back to one minute and re-enables submission', async () => {
  const c = await scene();
  const invalidHeaders: Record<string, string>[] = [
    {}, { 'Retry-After': 'invalid' }, { 'Retry-After': '-1' }, { 'Retry-After': '' },
  ];
  for (const headers of invalidHeaders) {
    c.http.enqueue({ ...response(429), headers });
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent(strings.auth.rateLimited(1));
    expect(screen.getByTestId('login-submit')).not.toBeBusy();
    expect(screen.getByTestId('login-submit')).not.toBeDisabled();
  }
  expect(c.http.requests).toHaveLength(invalidHeaders.length);
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.kick).not.toHaveBeenCalled();
});

test('SE-2 first login stores its session and kicks the engine before the first pull completes', async () => {
  const c = await scene();
  const wire = wireSession('primary', 'login');
  const arrivalRead = c.pendingReply();
  c.http.enqueue(response(200, wire), () => arrivalRead.promise, response(200, c.page), response(200, { ...c.page, changes: [] }));
  await submit();
  expect(c.services.sessionUser()).toEqual(wire.user);
  expect(c.secretBox.snapshot()['session_tokens.primary']).toBe(JSON.stringify({
    access_token: wire.access_token, refresh_token: wire.refresh_token, access_expires_at: wire.access_expires_at,
  }));
  expect(c.kv.get('signed_out.primary')).toBeNull();
  expect(c.kick).toHaveBeenCalledTimes(1);
  expect(c.kick).toHaveBeenCalledWith('login');
  expect(c.store.getState()).toMatchObject({ ready: true, family: null });
  expect(c.http.requests[1]?.url).toBe(`${servers.primary}/sync?since=0&limit=1`);
  await act(async () => {
    arrivalRead.resolve(response(200, c.page));
    await c.kick.mock.results[0]?.value;
  });
  expect(c.store.getState().family).toEqual(c.family);
});

test('R1.11 an expired session shows the exact pending-outbox count above the form', async () => {
  await scene({ previousUser: true, pendingCount: 2 });
  expect(screen.getByText(strings.auth.pendingChanges(2))).toBeOnTheScreen();
  expect(screen.queryByTestId('login-reserve-note')).toBeNull();
});

test('R1.11 an expired session with an empty outbox shows no pending-outbox note', async () => {
  await scene({ previousUser: true });
  expect(screen.queryByText(strings.auth.pendingChanges(0))).toBeNull();
  expect(screen.queryByText(strings.auth.pendingChanges(1))).toBeNull();
});

test('SE-2 same-user login preserves pending changes without asking to discard them', async () => {
  const c = await scene({ previousUser: true, pendingCount: 2 });
  const before = c.driver.all('SELECT * FROM outbox ORDER BY seq');
  const arrivalRead = c.pendingReply();
  c.http.enqueue(response(200, wireSession('primary', 'renewed')), () => arrivalRead.promise);
  await submit();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(before);
  expect(c.store.getState().pets[c.pet.id]).toEqual(c.pet);
  expect(c.removeAssetFiles).not.toHaveBeenCalled();
  expect(c.kick).toHaveBeenCalledWith('login');
});

test.each(['confirm', 'close'] as const)('SE-3 different-user login waits for the discard Sheet: %s', async (decision) => {
  const c = await scene({ previousUser: true, pendingCount: 2 });
  const wire = { ...wireSession('primary', 'different'), user: {
    ...wireSession('primary').user, id: '00000000-0000-4000-8000-000000000099', email: 'other@example.invalid',
  } };
  const before = {
    rows: c.driver.all('SELECT * FROM replica ORDER BY entity, id'),
    outbox: c.driver.all('SELECT * FROM outbox ORDER BY seq'),
    user: c.kv.get('session_user'), secrets: c.secretBox.snapshot(),
  };
  c.http.enqueue(response(200, wire));
  await submit(wire.user.email);
  const sheet = screen.getByRole('dialog', { name: strings.auth.discardTitle });
  expect(within(sheet).getByText(strings.auth.discardTitle)).toBeOnTheScreen();
  expect(within(sheet).getByText(strings.auth.discardBody(2))).toBeOnTheScreen();
  expect(within(sheet).getAllByRole('button')).toHaveLength(2);
  expect(screen.getByTestId('login-discard-confirm')).toHaveTextContent(strings.auth.discardConfirm);
  expect(c.kv.get('session_user')).toBe(before.user);
  expect(c.secretBox.snapshot()).toEqual(before.secrets);
  expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(before.outbox);
  expect(c.kick).not.toHaveBeenCalled();
  if (decision === 'confirm') {
    c.queueArrival();
    await fireEvent.press(screen.getByTestId('login-discard-confirm'));
    await act(async () => { await c.kick.mock.results[0]?.value; });
    expect(c.services.sessionUser()).toEqual(wire.user);
    expect(c.outbox.count()).toBe(0);
    expect(c.replica.get('pets', c.pet.id)).toBeNull();
    expect(c.removeAssetFiles).toHaveBeenCalledTimes(1);
    expect(c.cancelNotifications).toHaveBeenCalledTimes(1);
    expect(c.stopTracking).toHaveBeenCalledTimes(1);
    expect(c.kick).toHaveBeenCalledWith('login');
  } else {
    await fireEvent.press(screen.getByRole('button', { name: strings.dismiss }));
    await act(async () => { await jest.advanceTimersByTimeAsync(200); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(c.kv.get('session_user')).toBe(before.user);
    expect(c.secretBox.snapshot()).toEqual(before.secrets);
    expect(c.driver.all('SELECT * FROM replica ORDER BY entity, id')).toEqual(before.rows);
    expect(c.driver.all('SELECT * FROM outbox ORDER BY seq')).toEqual(before.outbox);
    expect(c.removeAssetFiles).not.toHaveBeenCalled();
    expect(c.kick).not.toHaveBeenCalled();
  }
});

test('RS-9 reserve login replaces the pending note and locks the preserved email', async () => {
  const c = await scene({ server: 'reserve', previousUser: true, pendingCount: 2 });
  expect(screen.getByTestId('login-reserve-note')).toHaveTextContent(strings.auth.reserveNote);
  expect(screen.queryByText(strings.auth.pendingChanges(2))).toBeNull();
  const email = screen.getByTestId('login-email');
  expect(email.props.value).toBe(credentials.email);
  expect(email.props.editable).toBe(false);
  await fireEvent.changeText(email, 'other@example.invalid');
  expect(screen.getByTestId('login-email').props.value).toBe(credentials.email);
  expect(c.http.requests).toEqual([]);
});

test('RS-9 same-user reserve login continues real arrival and keeps primary tokens', async () => {
  const c = await scene({ server: 'reserve', previousUser: true });
  const primaryTokens = c.secretBox.snapshot()['session_tokens.primary'];
  const wire = wireSession('reserve', 'login');
  c.http.enqueue(response(200, wire));
  c.queueArrival();
  await fireEvent.changeText(screen.getByTestId('login-password'), credentials.password);
  await fireEvent.press(screen.getByTestId('login-submit'));
  await act(async () => { await c.kick.mock.results[0]?.value; });
  expect(c.secretBox.snapshot()['session_tokens.primary']).toBe(primaryTokens);
  expect(await c.session.accessToken('reserve')).toBe(wire.access_token);
  expect(c.kv.get('signed_out.reserve')).toBeNull();
  expect(c.kv.get('reseeded_epoch.reserve')).toBe(c.page.epoch);
  expect(c.store.getState().family).toEqual(c.family);
  expect(c.http.requests.map(({ url }) => url)).toEqual([
    `${servers.reserve}/auth/login`, `${servers.reserve}/sync?since=0&limit=1`,
    `${servers.reserve}/sync?since=0&limit=500`, `${servers.reserve}/sync?since=1&limit=500`,
  ]);
  expect(c.kick).toHaveBeenCalledWith('login');
});
