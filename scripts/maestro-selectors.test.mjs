import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { selectorProblems } from './maestro-selectors.mjs';

test('P7-5 rejects text selectors on deliberately bad fixture strings', () => {
  for (const yaml of [
    '- tapOn: Login', '- assertVisible: "Done"', '- assertNotVisible: Missing',
    '- longPressOn:\n    text: Done', '- tapOn: { text: Done }',
    '- extendedWaitUntil:\n    visible:\n      text: Done\n    timeout: 3000',
    '- runFlow:\n    when:\n      visible: Done\n    commands:\n      - back',
    '- tapOn:\n    id: button\n    below:\n      text: Name',
    '- tapOn:\n    point: 50%,50%',
    '- tapOn:\n    "text": Done',
    '- assertVisible: { id: button, text: Done }',
    '- assertVisible: *hiddenSelector',
  ]) assert.ok(selectorProblems(yaml).length > 0, yaml);
});

test('P7-5 accepts id selectors, input text, JavaScript assertions and gestures', () => {
  assert.deepEqual(selectorProblems(`appId: app.pawlaris
---
- tapOn:
    id: login-email
- inputText: \${EMAIL}
- assertTrue: \${maestro.copiedText === output.expected}
- swipe:
    start: '50%, 80%'
    end: '50%, 25%'
- extendedWaitUntil:
    notVisible:
      id: photo-uploading
    timeout: 3000
`), []);
});

test('P7-5 every Maestro flow recursively selects by testID only', () => {
  const root = resolve('apps/mobile/.maestro');
  const paths = readdirSync(root, { recursive: true }).filter((path) => /\.ya?ml$/.test(path));
  assert.ok(paths.length >= 11, 'all nine single-phone and two paired flows exist');
  for (const path of paths) {
    assert.deepEqual(selectorProblems(readFileSync(resolve(root, path), 'utf8')), [], path);
  }
});
