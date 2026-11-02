import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backup = await readFile(new URL('../infra/backup.sh', import.meta.url), 'utf8');
const restore = await readFile(new URL('../infra/restore.sh', import.meta.url), 'utf8');
const pull = await readFile(new URL('./pull-backup.ps1', import.meta.url), 'utf8');
const modelFiles = [
  '../services/api/app/models/identity.py', '../services/api/app/models/pets.py',
  '../services/api/app/models/tasks.py', '../services/api/app/models/walks.py',
  '../services/api/app/models/assets.py',
];
const modelText = (await Promise.all(modelFiles.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
const tables = ['family', 'app_user', 'pet', 'weight_entry', 'health_event', 'task_template', 'task_completion', 'task_timer', 'walk_session', 'asset'];

test('backup table list matches syncable models', () => {
  for (const table of tables) {
    assert.match(modelText, new RegExp(`__tablename__ = "${table}"`));
    assert.match(backup, new RegExp(`\\b${table}\\b`));
  }
  for (const excluded of ['refresh_token', 'invite_code', 'push_device', 'applied_mutation', 'walk_route']) {
    assert.doesNotMatch(backup, new RegExp(`\\b${excluded}\\b`));
  }
});

test('backup verifies before encryption and always drops verify database', () => {
  assert.match(backup, /before_file/);
  assert.match(backup, /restored_file/);
  assert.match(backup, /after_file/);
  assert.match(backup, /before.*restored|restored.*after/s);
  assert.match(backup, /drop_verify\(\)/);
  assert.match(backup, /trap finish EXIT/);
});

test('retention and failure rules are present', () => {
  assert.match(backup, /tail -n \+15/);
  assert.match(pull, /Select-Object -Skip 8/);
  assert.match(backup, /status":"failed/);
  assert.match(backup, /set -Eeuo pipefail/);
});

test('pull rejects stale metadata and verifies checksum before moving', () => {
  assert.match(pull, /TotalHours -gt 48/);
  assert.match(pull, /Get-FileHash -Algorithm SHA256/);
  assert.match(pull, /Move-Item -Force -Path \$tempArchive/);
});

test('restore changes and prints sync epoch', () => {
  assert.match(restore, /UPDATE server_meta SET sync_epoch = gen_random_uuid\(\)/);
  assert.match(restore, /SELECT sync_epoch FROM server_meta/);
});
