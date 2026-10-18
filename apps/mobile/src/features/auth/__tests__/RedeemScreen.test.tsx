import type { AuthRedeemBody } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { response, servers, wireSession } from '../../../auth/__tests__/support';
import { strings } from '../../../i18n/strings';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { RedeemScreen } from '../RedeemScreen';
import { authContext, credentials, type AuthContext } from './support';

const initialAppState = AppState.currentState;
const redemption = { ...credentials, code: '7K2M9QX4TB', display_name: 'Test member' } satisfies AuthRedeemBody;
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

async function scene() {
  const c = await authContext();
  context = c;
  await render(<RedeemScreen services={c.services} active />);
  return c;
}

async function fillForm(overrides: Partial<AuthRedeemBody> = {}) {
  const body = { ...redemption, ...overrides };
  await fireEvent.changeText(screen.getByTestId('redeem-code'), body.code);
  await fireEvent.changeText(screen.getByTestId('redeem-name'), body.display_name);
  await fireEvent.changeText(screen.getByTestId('redeem-email'), body.email);
  await fireEvent.changeText(screen.getByTestId('redeem-password'), body.password);
}

test('R5.1 redeem paints its four labelled fields and submit button before any HTTP', async () => {
  const c = await scene();
  const fields = [
    ['redeem-code', strings.auth.redeemCode], ['redeem-name', strings.auth.redeemName],
    ['redeem-email', strings.auth.redeemEmail], ['redeem-password', strings.auth.password],
  ] as const;
  for (const [id, label] of fields) {
    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByLabelText(label)).toHaveProp('testID', id);
  }
  expect(screen.getByTestId('redeem-password').props.secureTextEntry).toBe(true);
  expect(screen.getByTestId('redeem-submit')).toHaveTextContent(strings.auth.redeem);
  expect(screen.getByTestId('redeem-submit')).not.toBeBusy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(c.http.requests).toEqual([]);
});

test.each([
  { status: 410, message: strings.auth.invalidInvite },
  { status: 409, message: strings.auth.emailInUse },
])('R1.3 redeem maps HTTP $status to its specified error without adopting a session', async ({ status, message }) => {
  const c = await scene();
  c.http.enqueue(response(status, { detail: 'Never display this detail.' }));
  await fillForm();
  await fireEvent.press(screen.getByTestId('redeem-submit'));
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]).toMatchObject({ method: 'POST', url: `${servers.primary}/auth/redeem`, body: redemption });
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByText('Never display this detail.')).toBeNull();
  expect(screen.getByTestId('redeem-submit')).not.toBeBusy();
  expect(screen.getByTestId('redeem-code')).toBeOnTheScreen();
  expect(c.services.sessionUser()).toBeNull();
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.kick).not.toHaveBeenCalled();
});

test('P4-4 the invite code auto-capitalizes, allows ten characters and submits uppercase', async () => {
  const c = await scene();
  const code = screen.getByTestId('redeem-code');
  expect(code.props.autoCapitalize).toBe('characters');
  expect(code.props.maxLength).toBe(10);
  c.http.enqueue(response(410));
  await fillForm({ code: redemption.code.toLowerCase() });
  expect(screen.getByTestId('redeem-code').props.value).toBe(redemption.code);
  await fireEvent.press(screen.getByTestId('redeem-submit'));
  expect(c.http.requests[0]?.body).toEqual(redemption);
});

test.each(['', '7K2M9QX4T'])('P4-4 an invite code shorter than ten characters sends no HTTP: %s', async (code) => {
  const c = await scene();
  await fillForm({ code });
  await fireEvent.press(screen.getByTestId('redeem-submit'));
  expect(c.http.requests).toEqual([]);
  expect(c.kick).not.toHaveBeenCalled();
});

test.each(['', 'fakepwd'])('P4-4 a password shorter than eight characters sends no HTTP: %s', async (password) => {
  const c = await scene();
  await fillForm({ password });
  await fireEvent.press(screen.getByTestId('redeem-submit'));
  expect(c.http.requests).toEqual([]);
  expect(c.secretBox.snapshot()).toEqual({});
  expect(c.kick).not.toHaveBeenCalled();
});

test('SE-2 redeem accepts an eight-character password, stores the session and kicks the engine', async () => {
  const c = await scene();
  const password = 'fakepass';
  const wire = wireSession('primary', 'redeem');
  c.http.enqueue(response(200, wire));
  c.queueArrival();
  await fillForm({ password });
  await fireEvent.press(screen.getByTestId('redeem-submit'));
  await act(async () => { await c.kick.mock.results[0]?.value; });
  expect(c.http.requests[0]).toMatchObject({ method: 'POST', url: `${servers.primary}/auth/redeem`,
    body: { ...redemption, password } });
  expect(c.services.sessionUser()).toEqual(wire.user);
  expect(await c.session.accessToken('primary')).toBe(wire.access_token);
  expect(c.secretBox.snapshot()['session_tokens.primary']).toBe(JSON.stringify({
    access_token: wire.access_token, refresh_token: wire.refresh_token, access_expires_at: wire.access_expires_at,
  }));
  expect(c.kv.get('signed_out.primary')).toBeNull();
  expect(c.kick).toHaveBeenCalledTimes(1);
  expect(c.kick).toHaveBeenCalledWith('login');
  expect(c.store.getState().family).toEqual(c.family);
});

test('R5.1 pending redemption keeps the fields visible and prevents a second submission', async () => {
  const c = await scene();
  const reply = c.pendingReply();
  c.http.enqueue(() => reply.promise);
  await fillForm();
  await fireEvent.press(screen.getByTestId('redeem-submit'));
  const button = screen.getByTestId('redeem-submit');
  expect(button).toBeBusy();
  expect(button).toBeDisabled();
  for (const id of ['redeem-code', 'redeem-name', 'redeem-email', 'redeem-password']) {
    expect(screen.getByTestId(id)).toBeOnTheScreen();
  }
  await fireEvent.press(button);
  expect(c.http.requests).toHaveLength(1);
  await act(() => { reply.resolve(response(410)); });
  expect(screen.getByTestId('redeem-submit')).not.toBeBusy();
});
