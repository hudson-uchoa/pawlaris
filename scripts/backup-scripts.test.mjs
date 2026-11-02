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
const postgresCalls = (script) => script.match(/compose exec -T postgres [^\n]*(?:\\\r?\n[^\n]*)*/g) ?? [];

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
  for (const call of postgresCalls(backup)) {
    assert.match(call, /-U\s+"\$db_user"/);
  }
  assert.match(backup, /paste "\$before_file" "\$restored_file" "\$after_file" \| awk '\{ if \(\$1 > \$2 \|\| \$2 > \$3\) exit 1 \}'/);
  assert.doesNotMatch(backup, /compose run[^\n]*-v/);
  assert.match(backup, /compose run --rm --no-deps -T api[\s\S]*tar -C \/data -cf - blobs[\s\S]*> "\$blobs_tar"/);
  assert.match(backup, /drop_verify\(\)/);
  assert.match(backup, /trap finish EXIT/);
});

test('checksum names the published archive', () => {
  assert.match(
    backup,
    /archive_date="\$\(date -u \+%Y-%m-%d\)"[\s\S]*encrypted_file="\$\{tmp_dir\}\/\$\{archive_date\}\.tar\.age"[\s\S]*checksum_file="\$\{tmp_dir\}\/\$\{archive_date\}\.tar\.age\.sha256"[\s\S]*archive_path="\$\{BACKUP_ROOT\}\/\$\{archive_date\}\.tar\.age"/,
  );
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
  for (const call of postgresCalls(restore)) {
    assert.match(call, /-U\s+"\$db_user"/);
  }
  const postgresStart = restore.indexOf('compose up -d --wait postgres');
  const firstExec = restore.indexOf('compose exec');
  assert.ok(postgresStart >= 0 && postgresStart < firstExec);
  assert.match(restore, /UPDATE server_meta SET sync_epoch = gen_random_uuid\(\)/);
  assert.match(restore, /SELECT sync_epoch FROM server_meta/);
});
