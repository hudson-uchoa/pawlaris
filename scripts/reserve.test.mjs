import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = join(process.cwd(), 'scripts', 'reserve.ps1');

async function makeCase() {
  const root = await mkdtemp(join(tmpdir(), 'pawlaris reserve-'));
  const backupRoot = join(root, 'backup folder');
  const stubRoot = join(root, 'stubs');
  await mkdir(backupRoot);
  await mkdir(stubRoot);
  const stubLog = join(root, 'calls.log');
  for (const tool of ['age', 'tar', 'dropdb', 'createdb', 'pg_restore', 'psql', 'uv', 'tailscale']) {
    await writeFile(join(stubRoot, `${tool}.cmd`), '@echo %~nx0>>"%RESERVE_STUB_LOG%"\r\n');
  }
  const archive = join(backupRoot, '2026-11-03.tar.age');
  const key = join(root, 'age key.txt');
  const reserveEnv = join(root, 'reserve env.env');
  await writeFile(key, 'AGE-SECRET-KEY-PLACEHOLDER\n');
  await writeFile(reserveEnv, [
    'DATABASE_URL=postgresql+asyncpg://user:password@127.0.0.1:5432/pawlaris_reserve',
    'JWT_SECRET=01234567890123456789012345678901',
    `BLOB_DIR=${join(root, 'reserve blobs')}`,
    'SERVER_ROLE=reserve',
  ].join('\n'));
  return { root, backupRoot, stubRoot, stubLog, archive, key, reserveEnv };
}

async function putArchive(caseData, content = 'encrypted archive') {
  await writeFile(caseData.archive, content);
  const hash = createHash('sha256').update(content).digest('hex');
  await writeFile(`${caseData.archive}.sha256`, `${hash}  ${caseData.archive}\n`);
}

function runStart(caseData) {
  const environment = {
    ...process.env,
    PATH: `${caseData.stubRoot};${process.env.PATH ?? ''}`,
    RESERVE_STUB_LOG: caseData.stubLog,
  };
  return spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, 'start',
    '-BackupRoot', caseData.backupRoot,
    '-AgeKeyPath', caseData.key,
    '-ReserveEnvPath', caseData.reserveEnv,
    '-PidPath', join(caseData.root, 'reserve.pid'),
    '-LogPath', join(caseData.root, 'reserve.log'),
    '-RepoRoot', process.cwd(),
  ], { encoding: 'utf8', env: environment, windowsHide: true });
}

async function assertStoppedBeforeTools(caseData, result, message) {
  assert.notEqual(result.status, 0, message);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message));
  await assert.rejects(readFile(caseData.stubLog));
}

test('reserve start refuses without a pulled archive', async () => {
  const caseData = await makeCase();
  const result = runStart(caseData);
  await assertStoppedBeforeTools(caseData, result, 'No pulled backup archive was found');
});

test('reserve start refuses without the age key', async () => {
  const caseData = await makeCase();
  await putArchive(caseData);
  await rm(caseData.key);
  const result = runStart(caseData);
  await assertStoppedBeforeTools(caseData, result, 'The age key file was not found');
});

test('reserve start refuses a checksum mismatch before age', async () => {
  const caseData = await makeCase();
  await putArchive(caseData, 'corrupted archive');
  await writeFile(`${caseData.archive}.sha256`, `${'0'.repeat(64)}  ${caseData.archive}\n`);
  const result = runStart(caseData);
  await assertStoppedBeforeTools(caseData, result, 'Backup checksum verification failed');
});

test('reserve start refuses a database other than pawlaris_reserve', async () => {
  const caseData = await makeCase();
  await putArchive(caseData);
  await writeFile(caseData.reserveEnv, 'DATABASE_URL=postgresql+asyncpg://user:password@127.0.0.1:5432/pawlaris_dev\nJWT_SECRET=01234567890123456789012345678901\n');
  const result = runStart(caseData);
  await assertStoppedBeforeTools(caseData, result, 'The reserve DATABASE_URL must name pawlaris_reserve');
});
