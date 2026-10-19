import type { Ref } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { TextInputProps } from 'react-native';
import { response, servers } from '../../../auth/__tests__/support';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { LoginScreen } from '../LoginScreen';
import { authContext, credentials, type AuthContext } from './support';

const mockFocusPassword = jest.fn();
const mockFocusEmail = jest.fn();

jest.mock('react-native/Libraries/Components/TextInput/TextInput', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  function TextInput({ ref, ...props }: TextInputProps & { ref?: Ref<{ focus(): void }> }) {
    React.useImperativeHandle(ref, () => ({ focus: props.testID === 'login-password' ? mockFocusPassword : mockFocusEmail }));
    return React.createElement('TextInput', props);
  }
  return { __esModule: true, default: TextInput };
});

let context: AuthContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.clearAllMocks();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene() {
  const c = await authContext();
  context = c;
  await render(<LoginScreen services={c.services} active={false} onRedeem={jest.fn()} onLayout={jest.fn()} />);
  return c;
}

test('09 §1 / 09 §2.1 the email return key focuses login-password without submitting', async () => {
  const c = await scene();
  await fireEvent(screen.getByTestId('login-email'), 'submitEditing');
  expect(mockFocusPassword).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('login-email')).toHaveProp('returnKeyType', 'next');
  expect(mockFocusEmail).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test('09 §1 / 09 §2.1 the password return key submits the entered credentials once', async () => {
  const c = await scene();
  c.http.enqueue(response(401));
  await fireEvent.changeText(screen.getByTestId('login-email'), credentials.email);
  await fireEvent.changeText(screen.getByTestId('login-password'), credentials.password);
  await fireEvent(screen.getByTestId('login-password'), 'submitEditing');
  expect(c.http.requests).toHaveLength(1);
  expect(c.http.requests[0]).toMatchObject({ method: 'POST', url: `${servers.primary}/auth/login`, body: credentials });
});
