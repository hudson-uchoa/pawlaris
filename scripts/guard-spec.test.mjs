import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateSpecChanges } from './guard-spec.mjs';

const branch = 'phase/P0-foundation';
const task = '- [ ] **P0-8 — Pre-commit hooks and commit guard**\n  **Build:** hooks\n';
const change = { path: 'spec/08-tasks.md', before: task, after: task.replace('[ ]', '[~]') };

test('P0-8: checkbox-only state changes pass', () => {
  for (const state of ['[~]', '[x]']) {
    assert.deepEqual(validateSpecChanges([{ ...change, after: task.replace('[ ]', state) }],
      branch, undefined), []);
  }
});

for (const path of ['spec/00-constitution.md', 'spec/fixtures/vector.json',
  'spec/nested/file.ts', 'spec/contracts-extra/file.json']) {
  test(`P0-8: reject protected spec change in ${path}`, () => {
    assert.deepEqual(validateSpecChanges([{ path, before: 'old', after: 'new' }],
      branch, undefined), [path]);
  });
}

test('P0-8: reject task text edits, inserted/deleted lines and deleted files', () => {
  for (const after of [change.after.replace('hooks', 'new hooks'),
    `${change.after}\n`, change.after.split('\n').slice(1).join('\n'), null,
    '- [~] a new task\n']) {
    assert.deepEqual(validateSpecChanges([{ ...change, after }], branch, undefined),
      ['spec/08-tasks.md']);
  }
});

test('P0-8: reject a new backlog file and pseudo-checkboxes in prose', () => {
  assert.deepEqual(validateSpecChanges([{ ...change, before: null }], branch, undefined),
    ['spec/08-tasks.md']);
  assert.deepEqual(validateSpecChanges([{ ...change, before: 'Prose [ ]\n',
    after: 'Prose [~]\n' }], branch, undefined), ['spec/08-tasks.md']);
});

test('P0-8: allow questions, contracts and non-spec files', () => {
  for (const path of ['spec/QUESTIONS.md', 'spec/contracts/openapi.json', 'scripts/test.mjs']) {
    assert.deepEqual(validateSpecChanges([{ path, before: 'old', after: 'new' }],
      branch, undefined), []);
  }
});

test('P0-8: orchestrator override and branches outside phase pass', () => {
  const changes = [{ path: 'spec/README.md', before: 'old', after: 'new' }];
  assert.deepEqual(validateSpecChanges(changes, branch, 'orchestrator'), []);
  assert.deepEqual(validateSpecChanges(changes, 'main', undefined), []);
  assert.deepEqual(validateSpecChanges(changes, branch, 'implementer'), ['spec/README.md']);
});

test('P0-8: CLI inspects the index despite unstaged changes and catches renames', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pawlaris-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Child repositories must not inherit the parent hook's Git environment.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.startsWith('GIT_') && key !== 'PAWLARIS_ROLE'));
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const run = (role) => spawnSync(process.execPath,
    [fileURLToPath(new URL('./guard-spec.mjs', import.meta.url))],
    { cwd: root, env: { ...env, PAWLARIS_ROLE: role ?? '' }, encoding: 'utf8' });
  git('init', '-b', branch);
  git('config', 'user.name', 'Guard Test');
  git('config', 'user.email', 'guard@example.test');
  write(change.path, task);
  write('spec/protected file.md', 'original\n');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
  write(change.path, change.after);
  git('add', change.path);
  write(change.path, 'unstaged forbidden edit\n');
  assert.equal(run().status, 0);
  git('add', change.path);
  write(change.path, task);
  assert.equal(run().status, 1);
  assert.equal(run('orchestrator').status, 0);
  git('reset', '--hard', 'HEAD');
  git('mv', 'spec/protected file.md', 'outside.md');
  assert.equal(run().status, 1);
});
