import * as ExpoFileSystem from 'expo-file-system/legacy';
import { expoFileSystem, getDocumentDirectory } from '../../platform/expoFileSystem';
import { fakeClock } from '../../testing/fakeClock';

jest.mock('expo-file-system/legacy', () => {
  class UploadTask {
    uploadAsync = jest.fn();
    cancelAsync = jest.fn();
  }
  class DownloadResumable {
    downloadAsync = jest.fn();
    cancelAsync = jest.fn();
  }
  return {
    __esModule: true, documentDirectory: 'file:///fake/documents/',
    FileSystemUploadType: { BINARY_CONTENT: 0 }, UploadTask, DownloadResumable,
    getInfoAsync: jest.fn(), makeDirectoryAsync: jest.fn(), deleteAsync: jest.fn(),
    createUploadTask: jest.fn(), createDownloadResumable: jest.fn(),
  };
});

const url = 'https://files.invalid/assets/fake-asset';
const uri = 'file:///fake/documents/assets/fake-asset.jpg';
const clock = fakeClock(Date.UTC(2026, 9, 14, 12));
let uploadTask: ExpoFileSystem.UploadTask;
let downloadTask: ExpoFileSystem.DownloadResumable;

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ now: clock.now() });
  uploadTask = new ExpoFileSystem.UploadTask(url, uri);
  downloadTask = new ExpoFileSystem.DownloadResumable(url, uri);
  jest.spyOn(uploadTask, 'cancelAsync').mockResolvedValue(undefined);
  jest.spyOn(downloadTask, 'cancelAsync').mockResolvedValue(undefined);
  jest.spyOn(uploadTask, 'uploadAsync').mockResolvedValue({
    status: 201, headers: {}, mimeType: 'application/json', body: '{"id":"fake-asset"}',
  });
  jest.spyOn(downloadTask, 'downloadAsync').mockResolvedValue({
    uri, status: 200, headers: { 'Content-Type': 'image/jpeg' }, mimeType: 'image/jpeg',
  });
  jest.mocked(ExpoFileSystem.createUploadTask).mockReturnValue(uploadTask);
  jest.mocked(ExpoFileSystem.createDownloadResumable).mockReturnValue(downloadTask);
  jest.mocked(ExpoFileSystem.getInfoAsync).mockResolvedValue({
    uri, exists: true, isDirectory: false, size: 3, modificationTime: 0,
  });
  jest.mocked(ExpoFileSystem.makeDirectoryAsync).mockResolvedValue(undefined);
  jest.mocked(ExpoFileSystem.deleteAsync).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('native binary PUT: stream the file URI and send its measured length and hash', async () => {
  const headers = { Authorization: 'Bearer fake-access', 'X-Content-SHA256': 'a'.repeat(64),
    'Content-Length': '999' };
  expect(await expoFileSystem.upload(url, uri, headers)).toEqual({
    status: 201, headers: {}, body: { id: 'fake-asset' },
  });
  expect(ExpoFileSystem.createUploadTask).toHaveBeenCalledWith(url, uri, {
    httpMethod: 'PUT', uploadType: ExpoFileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { ...headers, 'Content-Length': '3' },
  });
  expect(uploadTask.uploadAsync).toHaveBeenCalledTimes(1);
  expect(uploadTask.cancelAsync).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('native upload timeout: cancel at 60 seconds without waiting for native settlement', async () => {
  jest.spyOn(uploadTask, 'uploadAsync').mockReturnValue(new Promise(() => {}));
  const outcome = expoFileSystem.upload(url, uri, {}).then(() => null, (error: unknown) => error);
  await jest.advanceTimersByTimeAsync(0);
  clock.advance(59_999);
  await jest.advanceTimersByTimeAsync(59_999);
  expect(uploadTask.cancelAsync).not.toHaveBeenCalled();
  clock.advance(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await outcome).toEqual(new Error('File transfer timed out'));
  expect(uploadTask.cancelAsync).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('native upload cancellation error: still report the timeout and release the timer', async () => {
  jest.spyOn(uploadTask, 'uploadAsync').mockReturnValue(new Promise(() => {}));
  jest.spyOn(uploadTask, 'cancelAsync').mockRejectedValue(new Error('Simulated cancellation failure'));
  const outcome = expoFileSystem.upload(url, uri, {}).then(() => null, (error: unknown) => error);
  await jest.advanceTimersByTimeAsync(0);
  clock.advance(60_000);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(await outcome).toEqual(new Error('File transfer timed out'));
  expect(jest.getTimerCount()).toBe(0);
});

test.each([null, undefined])('native upload cancelled: an absent native result rejects (%#)', async (result) => {
  jest.spyOn(uploadTask, 'uploadAsync').mockResolvedValue(result);
  await expect(expoFileSystem.upload(url, uri, {})).rejects.toThrow('File transfer was cancelled');
  expect(jest.getTimerCount()).toBe(0);
});

test('native upload non-JSON failure: retain the HTTP status and response headers', async () => {
  jest.spyOn(uploadTask, 'uploadAsync').mockResolvedValue({
    status: 503, headers: { 'Retry-After': '7' }, mimeType: 'text/plain', body: 'Unavailable',
  });
  expect(await expoFileSystem.upload(url, uri, {})).toEqual({
    status: 503, headers: { 'Retry-After': '7' }, body: 'Unavailable',
  });
});

test('native missing upload file: send no request', async () => {
  jest.mocked(ExpoFileSystem.getInfoAsync).mockResolvedValue({ uri, exists: false, isDirectory: false });
  await expect(expoFileSystem.upload(url, uri, {})).rejects.toThrow('The upload file is unavailable');
  expect(ExpoFileSystem.createUploadTask).not.toHaveBeenCalled();
});

test('native directory as upload: send no request', async () => {
  jest.mocked(ExpoFileSystem.getInfoAsync).mockResolvedValue({
    uri, exists: true, isDirectory: true, size: 0, modificationTime: 0,
  });
  await expect(expoFileSystem.upload(url, uri, {})).rejects.toThrow('The upload file is unavailable');
  expect(await expoFileSystem.exists(uri)).toBe(false);
});

test('native download: create the cache directory and pass the auth header', async () => {
  expect(await expoFileSystem.download(url, uri, { Authorization: 'Bearer fake-access' })).toEqual({
    status: 200, headers: { 'Content-Type': 'image/jpeg' }, body: null,
  });
  expect(ExpoFileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
    'file:///fake/documents/assets', { intermediates: true },
  );
  expect(ExpoFileSystem.createDownloadResumable).toHaveBeenCalledWith(url, uri, {
    headers: { Authorization: 'Bearer fake-access' },
  });
  expect(ExpoFileSystem.deleteAsync).not.toHaveBeenCalled();
  expect(await expoFileSystem.exists(uri)).toBe(true);
});

test('native failed download: remove response bytes so they cannot become a cached image', async () => {
  jest.spyOn(downloadTask, 'downloadAsync').mockResolvedValue({
    uri, status: 404, headers: {}, mimeType: 'application/json',
  });
  expect(await expoFileSystem.download(url, uri, {})).toEqual({ status: 404, headers: {}, body: null });
  expect(ExpoFileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
});

test('native download timeout: cancel after 15 seconds and remove partial bytes', async () => {
  jest.spyOn(downloadTask, 'downloadAsync').mockReturnValue(new Promise(() => {}));
  const outcome = expoFileSystem.download(url, uri, {}).then(() => null, (error: unknown) => error);
  await jest.advanceTimersByTimeAsync(0);
  clock.advance(15_000);
  await jest.advanceTimersByTimeAsync(15_000);
  expect(await outcome).toEqual(new Error('File transfer timed out'));
  expect(downloadTask.cancelAsync).toHaveBeenCalledTimes(1);
  expect(ExpoFileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  expect(jest.getTimerCount()).toBe(0);
});

test('native remove: delete idempotently and report absent bytes', async () => {
  await expoFileSystem.remove(uri);
  expect(ExpoFileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  jest.mocked(ExpoFileSystem.getInfoAsync).mockResolvedValue({ uri, exists: false, isDirectory: false });
  expect(await expoFileSystem.exists(uri)).toBe(false);
});

test('native document directory: return the SDK directory or a clear error if unavailable', () => {
  expect(getDocumentDirectory()).toBe('file:///fake/documents/');
  const property = jest.replaceProperty(ExpoFileSystem, 'documentDirectory', null);
  try {
    expect(getDocumentDirectory).toThrow('The document directory is unavailable');
  } finally {
    property.restore();
  }
});
