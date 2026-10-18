import * as ExpoFileSystem from 'expo-file-system/legacy';
import { fakeClock } from '../../testing/fakeClock';
import { fakeLogFiles } from '../../testing/fakeLogFiles';
import { createExpoLogFiles, createLogger, logFileLimit } from '../logger';

const epoch = Date.UTC(2026, 9, 18, 12);
const ts = new Date(epoch).toISOString();
const line = (event: string) => `${JSON.stringify({ ts, level: 'info', event })}\n`;
const byteLength = (text: string): number => encodeURIComponent(text).replace(/%[a-f\d]{2}/gi, 'x').length;

afterEach(() => { jest.restoreAllMocks(); });

test('Q-40 logger uses the injected clock, level, event and flat fields', async () => {
  const clock = fakeClock(epoch);
  const files = fakeLogFiles();
  const logger = createLogger(clock, files);
  await logger.write('reseed_row_rejected', { entity: 'pets', id: 'row-id', code: 422 }, 'warn');
  clock.advance(1500);
  await logger.write('sync_finished');
  expect(files.active.split('\n').filter(Boolean).map((record): unknown => JSON.parse(record))).toEqual([
    { ts, level: 'warn', event: 'reseed_row_rejected', entity: 'pets', id: 'row-id', code: 422 },
    { ts: new Date(epoch + 1500).toISOString(), level: 'info', event: 'sync_finished' },
  ]);
});

test('Q-40 logger rotates only when the next append passes 256 KiB', async () => {
  const files = fakeLogFiles();
  const logger = createLogger(fakeClock(epoch), files);
  const overhead = byteLength(`${JSON.stringify({ code: '', ts, level: 'info', event: 'boundary' })}\n`);
  await logger.write('boundary', { code: 'a'.repeat(logFileLimit - overhead) });
  expect(byteLength(files.active)).toBe(262144);
  expect(files.rotations).toBe(0);
  const full = files.active;
  await logger.write('next');
  expect(files.rotations).toBe(1);
  expect(files.archive).toBe(full);
  expect(files.active).toBe(line('next'));
});

test.each(['é', '🌠'])('Q-40 rotation counts UTF-8 bytes for %s', async (character) => {
  const files = fakeLogFiles();
  const logger = createLogger(fakeClock(epoch), files);
  const overhead = byteLength(`${JSON.stringify({ code: '', ts, level: 'info', event: 'boundary' })}\n`);
  const width = byteLength(character);
  const padding = logFileLimit - overhead;
  await logger.write('boundary', { code: character.repeat(Math.floor(padding / width)) + 'a'.repeat(padding % width) });
  expect(byteLength(files.active)).toBe(logFileLimit);
  expect(files.rotations).toBe(0);
  await logger.write('next');
  expect(files.rotations).toBe(1);
  expect(byteLength(files.archive)).toBe(logFileLimit);
});

test('Q-40 logger replaces its one archive and exports archive before active', async () => {
  const files = fakeLogFiles();
  const logger = createLogger(fakeClock(epoch), files);
  const overhead = byteLength(`${JSON.stringify({ code: '', ts, level: 'info', event: 'boundary' })}\n`);
  for (const code of ['a', 'b', 'c']) {
    await logger.write('boundary', { code: code.repeat(logFileLimit - overhead) });
  }
  expect(files.rotations).toBe(2);
  expect((JSON.parse(files.archive) as { code: string }).code.startsWith('b')).toBe(true);
  expect((JSON.parse(files.active) as { code: string }).code.startsWith('c')).toBe(true);
  expect(await logger.exportText()).toBe(files.archive + files.active);
  expect(byteLength(await logger.exportText())).toBe(512 * 1024);
});

test('Q-40 logger serializes concurrent writes and exports after earlier writes', async () => {
  const files = fakeLogFiles(line('existing'), line('archived'));
  const logger = createLogger(fakeClock(epoch), files);
  const first = logger.write('first');
  const second = logger.write('second');
  const exported = logger.exportText();
  await Promise.all([first, second]);
  expect(await exported).toBe(line('archived') + line('existing') + line('first') + line('second'));
});

test('Q-40 an oversized record cannot exceed the file limit or poison the queue', async () => {
  const files = fakeLogFiles();
  const logger = createLogger(fakeClock(epoch), files);
  await expect(logger.write('oversized', { code: 'a'.repeat(logFileLimit) })).rejects.toThrow(RangeError);
  expect(files.active).toBe('');
  await logger.write('next');
  expect(await logger.exportText()).toBe(line('next'));
});

test('logger reports storage failure without its contents and allows the next write', async () => {
  const files = fakeLogFiles();
  const write = jest.spyOn(files, 'write').mockRejectedValueOnce(new Error('Sensitive storage error details'));
  const report = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logger = createLogger(fakeClock(epoch), files);
  await logger.write('first');
  expect(report).toHaveBeenCalledWith('Mobile log storage failed');
  expect(report.mock.calls.flat().join(' ')).not.toContain('Sensitive storage error details');
  await logger.write('next');
  expect(write).toHaveBeenCalledTimes(2);
  expect(await logger.exportText()).toBe(line('next'));
});

test('Expo log files read missing files as empty and retain only active and previous', async () => {
  const disk = new Map<string, string>();
  jest.spyOn(ExpoFileSystem, 'getInfoAsync').mockImplementation(async (uri) => disk.has(uri)
    ? { exists: true, uri, isDirectory: false, size: disk.get(uri)?.length ?? 0, modificationTime: 0 }
    : { exists: false, uri, isDirectory: false });
  jest.spyOn(ExpoFileSystem, 'makeDirectoryAsync').mockResolvedValue(undefined);
  jest.spyOn(ExpoFileSystem, 'readAsStringAsync').mockImplementation(async (uri) => disk.get(uri) ?? '');
  jest.spyOn(ExpoFileSystem, 'writeAsStringAsync').mockImplementation(async (uri, text) => { disk.set(uri, text); });
  jest.spyOn(ExpoFileSystem, 'deleteAsync').mockImplementation(async (uri) => { disk.delete(uri); });
  jest.spyOn(ExpoFileSystem, 'moveAsync').mockImplementation(async ({ from, to }) => {
    disk.set(to, disk.get(from) ?? ''); disk.delete(from);
  });
  const files = createExpoLogFiles('file:///fake/documents/');
  expect(await files.read()).toBe('');
  expect(await files.readArchive()).toBe('');
  await files.rotate();
  await files.write('first\n');
  await files.rotate();
  await files.write('second\n');
  await files.rotate();
  await files.write('third\n');
  expect(await files.readArchive()).toBe('second\n');
  expect(await files.read()).toBe('third\n');
  expect([...disk.keys()].sort()).toEqual([
    'file:///fake/documents/logs/active.jsonl', 'file:///fake/documents/logs/previous.jsonl',
  ]);
});
