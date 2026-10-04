import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCommitMessage } from './guard-commit-msg.mjs';

const branch = 'phase/P0-foundation';
const valid = 'feat(api): add undo as a tombstone\n\n' +
  'Undo sets undone_at and undone_by instead of deleting, so the undo\n' +
  'replicates to the other phone. The live-row unique index excludes\n' +
  'tombstones, which is what lets the same occurrence be completed again\n' +
  'with a new row.\n\nGate:\n' +
  '    uv run --directory services/api pytest tests/sync/test_completions.py -q\n' +
  '      14 passed in 3.21s\n' +
  '    pnpm verify --only security\n' +
  '      1 pass   0 fail   0 pending   of 1\n' +
  'Verify:\n    pnpm verify --allow-pending\n' +
  '      10 pass   0 fail   3 pending   of 13\n\n' +
  'Task: P2-10\nRefs: CP-3, CP-4, R3.22, R3.23\n';

test('P0-8: the AGENTS.md example passes', () => {
  assert.deepEqual(validateCommitMessage(valid, branch), []);
});

test('P0-8 R1: the AGENTS.md example with Git editor comments passes', () => {
  const message = valid + '\n' +
    '# Please enter the commit message for your changes. Lines starting\n' +
    "# with '#' will be ignored, and an empty message aborts the commit.\n" +
    '#\n# On branch phase/P0-foundation\n' +
    '# Changes to be committed:\n#\tmodified: scripts/guard-commit-msg.mjs\n';
  for (const newline of ['\n', '\r\n']) {
    assert.deepEqual(validateCommitMessage(message.replaceAll('\n', newline), branch), []);
  }
});

test('P0-8 R1: the AGENTS.md example with a scissors line and diff passes', () => {
  const message = valid + '\n' +
    '# ------------------------ >8 ------------------------\n' +
    '# Do not modify or remove the line above.\n' +
    'diff --git a/example.mjs b/example.mjs\n' +
    '--- a/example.mjs\n+++ b/example.mjs\n@@ -1 +1 @@\n+' + 'a'.repeat(100) + '\n';
  for (const newline of ['\n', '\r\n']) {
    assert.deepEqual(validateCommitMessage(message.replaceAll('\n', newline), branch), []);
  }
});

const failures = [
  ['allowed type', valid.replace('feat(api)', 'style(api)'), 'type'],
  ['allowed scope', valid.replace('feat(api)', 'feat(server)'), 'scope'],
  ['72-character first line', valid.replace(valid.split('\n')[0],
    'feat(api): ' + 'a'.repeat(62)), 'first line'],
  ['lower-case subject', valid.replace('add undo', 'Add undo'), 'lower-case'],
  ['no trailing period', valid.replace('a tombstone\n', 'a tombstone.\n'), 'period'],
  ['blank line before body', valid.replace('tombstone\n\n', 'tombstone\n'), 'blank line'],
  ['72-character body lines', valid.replace('with a new row.', 'a'.repeat(73)), 'body line'],
  ['phase task footer', valid.replace('Task: P2-10\n', ''), 'Task'],
  ['task footer format', valid.replace('Task: P2-10', 'Task: P2'), 'Task'],
  ['task in body is not a footer', 'feat(api): add undo\n\nTask: P2-10\n' +
    'This paragraph continues the body.\n', 'Task'],
  ['footer block separation', 'feat(api): add undo\n\nExplain the change.\n' +
    'Task: P2-10\n', 'footer'],
  ['nonempty subject', 'feat(api): \n\nTask: P0-8\n', 'subject'],
  ['required conventional header', 'add undo\n\nTask: P0-8\n', 'header'],
];
for (const [rule, message, diagnostic] of failures) {
  test(`P0-8: reject ${rule} independently`, () => {
    const errors = validateCommitMessage(message, branch);
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(diagnostic));
  });
}

test('P0-8: accept every allowed type and scope and a breaking marker', () => {
  for (const type of ['feat', 'fix', 'test', 'refactor', 'perf', 'docs',
    'build', 'ci', 'chore', 'revert']) {
    for (const scope of ['shared', 'api', 'mobile', 'infra', 'harness',
      'spec', 'docs', 'repo']) {
      assert.deepEqual(validateCommitMessage(`${type}(${scope})!: add a change\n\n` +
        'Task: P0-8\n', branch), []);
    }
  }
});

test('P0-8: accept the 72-character boundary and URL/indented body exemptions', () => {
  assert.deepEqual(validateCommitMessage('feat(api): ' + 'a'.repeat(61) + '\n\n' +
    'b'.repeat(72) + '\n    ' + 'c'.repeat(90) + '\n\t' + 'd'.repeat(90) +
    '\nSee https://example.com/' + 'e'.repeat(90) + '\n\nTask: P0-8\n', branch), []);
});

test('P0-8: require a task only on phase branches and accept CRLF', () => {
  assert.deepEqual(validateCommitMessage('docs(repo): explain setup\n', 'main'), []);
  assert.deepEqual(validateCommitMessage(valid.replaceAll('\n', '\r\n'), branch), []);
});

test('P0-8: exempt Git-generated merge and revert messages', () => {
  for (const message of ["Merge branch 'main' into phase/P0-foundation\n",
    'Revert "feat(api): add undo"\n\nThis reverts commit ' + 'a'.repeat(40) + '.\n']) {
    assert.deepEqual(validateCommitMessage(message, branch), []);
  }
  assert.equal(validateCommitMessage('Revert something\n', branch).length, 1);
});
