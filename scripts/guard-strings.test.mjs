import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringProblems } from './guard-strings.mjs';

const screen = 'apps/mobile/src/features/pets/PetCard.tsx';

for (const literal of ['Salvar', '\u00e1', '\u03a9', '\u732b']) {
  test(`P7-3 refuses JSX text containing letters: ${literal}`, () => {
    assert.deepEqual(stringProblems(screen, `<Text>${literal}</Text>`), [1]);
  });
}

test('P7-3 reports multiline JSX text on each line containing letters', () => {
  assert.deepEqual(stringProblems(screen,
    'const view = (\r\n  <Text>\r\n    Salvar\r\n    agora\r\n  </Text>\r\n);'), [3, 4]);
});

for (const child of ["{' \u00b7 '}", '{value}', ' \n ', '123', ' \u00b7 / + \u2014 ', '123:45']) {
  test(`P7-3 allows JSX children without literal letters: ${child}`, () => {
    assert.deepEqual(stringProblems(screen, `<Text>${child}</Text>`), []);
  });
}

test('P7-3 checks text beside expressions, nested elements and fragments', () => {
  assert.deepEqual(stringProblems(screen,
    '<>Salvar {value}<Text>agora</Text> depois</>'), [1]);
});

test('P7-3 keeps string props outside the JSX text literal rule', () => {
  assert.deepEqual(stringProblems(screen,
    '<Button title="Salvar" accessibilityLabel="Salvar" />'), []);
});

test('P7-3 ignores JavaScript strings and comments containing JSX examples', () => {
  assert.deepEqual(stringProblems(screen,
    "// <Text>Salvar</Text>\nconst example = '<Text>Salvar</Text>';"), []);
});

test('P7-3 exempts the i18n directory and its descendants only', () => {
  for (const path of ['strings.ts', 'format.ts', 'nested/copy.tsx']) {
    assert.deepEqual(stringProblems(`apps/mobile/src/i18n/${path}`,
      '<Text>Salvar</Text>'), []);
  }
  assert.deepEqual(stringProblems('apps/mobile/src/i18n-extra/Copy.tsx',
    '<Text>Salvar</Text>'), [1]);
});

test('P7-3 exempts test fixtures because they are not app copy', () => {
  for (const path of ['__tests__/shell.test.tsx',
    'src/ui/__tests__/theme.test.tsx', 'src/ui/Label.test.tsx',
    'src/ui/Label.spec.jsx']) {
    assert.deepEqual(stringProblems(`apps/mobile/${path}`,
      '<Text>Care</Text>'), []);
  }
  assert.deepEqual(stringProblems('apps/mobile/src/features/testing/Label.tsx',
    '<Text>Care</Text>'), [1]);
});

test('P7-3 confines the string guard to apps/mobile', () => {
  assert.deepEqual(stringProblems('packages/shared/src/domain.tsx',
    '<Text>Salvar</Text>'), []);
});
