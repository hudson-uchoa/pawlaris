import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentProblems } from './guard-content.mjs';

const lan = ['192', '168', '0', '12'].join('.');

test('keeps phone screenshots and recordings out of the repository', () => {
  for (const path of ['docs/evidence/P0-9-samsung.png', 'docs/evidence/run.MP4', 'shot.jpeg']) {
    assert.equal(contentProblems(path, 10, null).length, 1);
  }
  for (const path of ['apps/mobile/assets/icon.png', 'docs/screens/screens-dawn.png']) {
    assert.deepEqual(contentProblems(path, 10, null), []);
  }
});

test('refuses files over 1 MB and LAN addresses in text', () => {
  assert.equal(contentProblems('apps/mobile/assets/big.png', 1024 * 1024 + 1, null).length, 1);
  assert.deepEqual(contentProblems('docs/a.md', 1024 * 1024, 'adb at <PC-LAN-IP>'), []);
  for (const address of [lan, '10.0.0.5', '172.20.1.1']) {
    assert.equal(contentProblems('docs/a.md', 10, `connect ${address}:8081`).length, 1);
  }
  for (const address of ['127.0.0.1', '172.32.0.1', '8.8.8.8']) {
    assert.deepEqual(contentProblems('docs/a.md', 10, address), []);
  }
});
