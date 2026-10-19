import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { createExpoLogShare } from '../../../platform/logShare';
import { exportLogs } from '../exportLogs';

jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///fake/cache/',
  makeDirectoryAsync: jest.fn(), writeAsStringAsync: jest.fn(), deleteAsync: jest.fn(),
}));

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { jest.restoreAllMocks(); });

test('R7.3 unavailable native sharing creates no export file', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
  await expect(exportLogs({ exportText: async () => '{"event":"sync_finished"}\n' }, createExpoLogShare()))
    .rejects.toThrow('Sharing is unavailable');
  expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('R7.3 credential redaction includes access tokens, camel case, nested fields and free text', async () => {
  const secret = 'test-only-credential-canary';
  const log = JSON.stringify({ event: 'sync_finished', status: 200, access_token: secret,
    nested: { refreshToken: secret, newPassword: secret },
    messages: [`bEaReR ${secret}`, 'Bearer', `accessToken=${secret}`, `password="${secret} with spaces"`,
      `password=${secret} with spaces`] });
  const shareText = jest.fn(async (_filename: string, _text: string) => {});
  await exportLogs({ exportText: async () => `${log}\n` }, { shareText });
  const text = shareText.mock.calls[0]?.[1] ?? '';
  expect(text).toContain('sync_finished');
  expect(text).toContain('200');
  expect(text).toContain('[REDACTED]');
  expect(text).not.toMatch(/Bearer/i);
  expect(text).not.toContain(secret);
});

test('R7.3 malformed log lines are withheld rather than leaking a truncated credential', async () => {
  const secret = 'test-only-truncated-canary';
  const shareText = jest.fn(async (_filename: string, _text: string) => {});
  await exportLogs({ exportText: async () => `{"event":"sync_started","password":"${secret}\n` }, { shareText });
  const text = shareText.mock.calls[0]?.[1] ?? '';
  expect(text).toContain('invalid_log_record_redacted');
  expect(text).not.toContain(secret);
});

test.each(['success', 'failure'] as const)(
  'R7.3 the native adapter shares a redacted UTF-8 txt file and removes it after %s', async (outcome) => {
    const write = jest.spyOn(FileSystem, 'writeAsStringAsync').mockResolvedValue(undefined);
    const mkdir = jest.spyOn(FileSystem, 'makeDirectoryAsync').mockResolvedValue(undefined);
    const remove = jest.spyOn(FileSystem, 'deleteAsync').mockResolvedValue(undefined);
    const share = jest.spyOn(Sharing, 'shareAsync');
    if (outcome === 'success') share.mockResolvedValue(undefined);
    else share.mockRejectedValue(new Error('Share unavailable'));
    const secret = 'test-only-native-export-canary';
    const pending = exportLogs({ exportText: async () => JSON.stringify({ event: 'sync_finished', accessToken: secret }) },
      createExpoLogShare());
    if (outcome === 'success') await pending;
    else await expect(pending).rejects.toThrow('Share unavailable');
    expect(mkdir).toHaveBeenCalledTimes(1);
    const call = write.mock.calls[0];
    expect(call).toBeDefined();
    const [uri, text, options] = call ?? ['', '', undefined];
    expect(uri).toMatch(/\/diagnostics\/pawlaris-logs\.txt$/);
    expect(text).not.toContain(secret);
    expect(text).toContain('sync_finished');
    expect(options).toEqual({ encoding: 'utf8' });
    expect(share).toHaveBeenCalledWith(uri, { mimeType: 'text/plain', UTI: 'public.plain-text' });
    expect(remove).toHaveBeenCalledWith(uri, { idempotent: true });
  },
);
