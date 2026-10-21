import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorProblems } from './guard-colors.mjs';

for (const literal of ['#abc', '#abcd', '#Ab12Ef', '#ab12EF80',
  'rgb(23, 21, 58)', 'rgba(23,21,58,0.45)']) {
  test(`P7-2 refuses ${literal} outside colour tokens`, () => {
    assert.deepEqual(colorProblems('apps/mobile/src/features/pets/PetCard.tsx',
      `const style = {\n  color: '${literal}',\n};`), [2]);
  });
}

test('P7-2 allows every colour form throughout the tokens directory', () => {
  for (const path of ['color.ts', 'pairs.ts', 'nested/palette.ts']) {
    assert.deepEqual(colorProblems(`apps/mobile/src/ui/tokens/${path}`,
      "const colors = ['#abc', '#abcd', '#abcdef', '#abcdef80', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)'];"), []);
  }
});

test('P7-2 exempts only the exact Expo app config path', () => {
  const source = "const splash = { backgroundColor: '#090B1A' };";
  assert.deepEqual(colorProblems('apps/mobile/app.config.ts', source), []);
  for (const path of ['app.config.tsx', 'app.config.ts.backup',
    'src/app.config.ts']) {
    assert.deepEqual(colorProblems(`apps/mobile/${path}`, source), [1]);
  }
});

test('P7-2 allows semantic token references', () => {
  assert.deepEqual(colorProblems('apps/mobile/src/ui/primitives/Card.tsx',
    'const style = { backgroundColor: color.surface, color: color.text };'), []);
});

test('P7-2 scans test assertions and testing builders without exemptions', () => {
  for (const path of ['__tests__/shell.test.tsx',
    'src/ui/__tests__/theme.test.tsx', 'src/testing/rowFactories.ts']) {
    assert.deepEqual(colorProblems(`apps/mobile/${path}`,
      "const expected = '#abcdef';"), [1]);
  }
});

test('P7-2 does not exempt a similarly named tokens sibling', () => {
  assert.deepEqual(colorProblems('apps/mobile/src/ui/tokens-extra/color.ts',
    "const color = '#abc';"), [1]);
});

test('P7-2 reports each offending line once and preserves line numbers', () => {
  assert.deepEqual(colorProblems('apps/mobile/src/ui/primitives/Card.tsx',
    "// semantic styles\r\nconst a = '#abc', b = 'rgba(1,2,3,0.5)';\r\n\r\nconst c = '#abcd';"), [2, 4]);
});

test('P7-2 confines the colour guard to apps/mobile', () => {
  assert.deepEqual(colorProblems('packages/shared/src/domain.ts',
    "const color = '#abcdef';"), []);
});
