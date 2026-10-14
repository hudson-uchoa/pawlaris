import * as ExpoFileSystem from 'expo-file-system/legacy';
import type { FileSystem } from './fileSystem';

export function getDocumentDirectory(): string {
  const uri = ExpoFileSystem.documentDirectory;
  if (uri === null) throw new Error('The document directory is unavailable');
  return uri;
}

async function withTimeout<T>(
  task: { cancelAsync(): Promise<void> }, pending: Promise<T | null | undefined>, timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Report the timeout even when native cancellation itself fails.
      void task.cancelAsync().catch(() => {});
      reject(new Error('File transfer timed out'));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([pending, timeout]);
    if (result === undefined || result === null) throw new Error('File transfer was cancelled');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export const expoFileSystem: FileSystem = {
  async exists(uri) {
    const info = await ExpoFileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory;
  },
  async download(url, uri, headers) {
    const directory = uri.slice(0, uri.lastIndexOf('/'));
    await ExpoFileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const task = ExpoFileSystem.createDownloadResumable(url, uri, { headers: { ...headers } });
    let result: ExpoFileSystem.FileSystemDownloadResult;
    try {
      result = await withTimeout(task, task.downloadAsync(), 15_000);
    } catch (error) {
      await ExpoFileSystem.deleteAsync(uri, { idempotent: true });
      throw error;
    }
    if (result.status < 200 || result.status >= 300) {
      await ExpoFileSystem.deleteAsync(uri, { idempotent: true });
    }
    return { status: result.status, headers: result.headers, body: null };
  },
  async upload(url, uri, headers) {
    const info = await ExpoFileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) throw new Error('The upload file is unavailable');
    const task = ExpoFileSystem.createUploadTask(url, uri, {
      httpMethod: 'PUT', uploadType: ExpoFileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...headers, 'Content-Length': String(info.size) },
    });
    const result = await withTimeout(task, task.uploadAsync(), 60_000);
    let body: unknown = result.body;
    try { body = JSON.parse(result.body) as unknown; }
    catch { /* Non-JSON error responses remain available for classification. */ }
    return { status: result.status, headers: result.headers, body };
  },
  async remove(uri) {
    await ExpoFileSystem.deleteAsync(uri, { idempotent: true });
  },
};
