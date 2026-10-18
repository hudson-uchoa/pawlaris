import * as ExpoFileSystem from 'expo-file-system/legacy';
import type { Clock } from './clock';

export const logFileLimit = 256 * 1024;
export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface LogFiles {
  read(): Promise<string>;
  readArchive(): Promise<string>;
  write(text: string): Promise<void>;
  rotate(): Promise<void>;
}

export interface Logger {
  write(event: string, fields?: LogFields, level?: LogLevel): Promise<void>;
  exportText(): Promise<string>;
}

export function createLogger(clock: Clock, files: LogFiles): Logger {
  let queue = Promise.resolve();
  let current: string | undefined;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
    // A failed operation must not prevent subsequent logging or exports.
    queue = pending.then(() => {}, () => {});
    return pending;
  };
  return {
    write(event, fields = {}, level = 'info') {
      const line = `${JSON.stringify({ ...fields, ts: new Date(clock.now()).toISOString(), level, event })}\n`;
      if (utf8Bytes(line) > logFileLimit) return Promise.reject(new RangeError('Log record exceeds the file limit'));
      return serialize(async () => {
        try {
          current ??= await files.read();
          if (utf8Bytes(current) + utf8Bytes(line) > logFileLimit) {
            await files.rotate();
            current = '';
          }
          const next = current + line;
          await files.write(next);
          current = next;
        } catch {
          current = undefined;
          // Logging cannot interrupt a sync cycle. Never print the exception:
          // filesystem errors may contain paths or other sensitive values.
          console.error('Mobile log storage failed');
        }
      });
    },
    exportText() {
      return serialize(async () => (await files.readArchive()) + (await files.read()));
    },
  };
}

function utf8Bytes(text: string): number {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}

export function createExpoLogFiles(documentDirectory: string): LogFiles {
  const directory = `${documentDirectory.replace(/\/+$/, '')}/logs`;
  const active = `${directory}/active.jsonl`;
  const archive = `${directory}/previous.jsonl`;
  const read = async (uri: string): Promise<string> => {
    const info = await ExpoFileSystem.getInfoAsync(uri);
    return info.exists ? ExpoFileSystem.readAsStringAsync(uri) : '';
  };
  return {
    read: () => read(active),
    readArchive: () => read(archive),
    async write(text) {
      await ExpoFileSystem.makeDirectoryAsync(directory, { intermediates: true });
      await ExpoFileSystem.writeAsStringAsync(active, text, { encoding: 'utf8' });
    },
    async rotate() {
      await ExpoFileSystem.deleteAsync(archive, { idempotent: true });
      if ((await ExpoFileSystem.getInfoAsync(active)).exists) {
        await ExpoFileSystem.moveAsync({ from: active, to: archive });
      }
    },
  };
}
