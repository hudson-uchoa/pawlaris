import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';
import { fakeSecretBox } from '../../testing/fakeSecretBox';
import { expoSecretBox } from '../secretBox';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));

afterEach(() => { jest.resetAllMocks(); });

test('SE-SECRET-ADAPTER: store, read and delete through the SecureStore API', async () => {
  const native = fakeSecretBox();
  jest.mocked(getItemAsync).mockImplementation(native.get);
  jest.mocked(setItemAsync).mockImplementation(native.set);
  jest.mocked(deleteItemAsync).mockImplementation(native.del);
  const box = expoSecretBox();
  expect(await box.get('session_tokens.primary')).toBeNull();
  await box.set('session_tokens.primary', 'fake-secret-value');
  expect(await box.get('session_tokens.primary')).toBe('fake-secret-value');
  await box.del('session_tokens.primary');
  expect(await box.get('session_tokens.primary')).toBeNull();
  expect(getItemAsync).toHaveBeenCalledWith('session_tokens.primary');
  expect(setItemAsync).toHaveBeenCalledWith('session_tokens.primary', 'fake-secret-value');
  expect(deleteItemAsync).toHaveBeenCalledWith('session_tokens.primary');
});

test('SE-SECRET-FAILURE: propagate a native storage failure', async () => {
  const failure = new Error('Fake secure storage failure');
  jest.mocked(setItemAsync).mockRejectedValue(failure);
  await expect(expoSecretBox().set('session_tokens.primary', 'fake-secret-value')).rejects.toBe(failure);
});
