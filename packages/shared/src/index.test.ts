import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import shared from './index';

describe('P0-3 shared package scaffold', () => {
  it('P0-3 exports an object', () => {
    expect(shared).toBeTypeOf('object');
    expect(shared).not.toBeNull();
  });
});

describe('RC-2 purity lint fixtures', () => {
  const eslint = new ESLint();
  beforeAll(async () => {
    await eslint.lintText('new Date(0).getTime();', { filePath: 'src/lint-fixture.ts' });
  });

  const forbiddenSyntax = [
    'Date.now();',
    "Date['now']();",
    'new Date();',
    'Date();',
    'Date(0);',
    'new Date(2026, 0);',
    'new Date(2026, 0, 1, 12, 30, 0, 0);',
    ...[
      'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString',
      'toDateString', 'toTimeString',
    ].flatMap((method) => [
      `new Date(0).${method}();`,
      `new Date(0)['${method}']();`,
    ]),
    'Math.random();',
    ...[
      'getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds',
      'getMinutes', 'getMonth', 'getSeconds', 'getTimezoneOffset', 'getYear',
      'setDate', 'setFullYear', 'setHours', 'setMilliseconds', 'setMinutes',
      'setMonth', 'setSeconds', 'setYear',
    ].map((method) => `new Date(0).${method}(0);`),
  ];

  it.each(forbiddenSyntax)('RC-2 reports %s', async (code) => {
    const results = await eslint.lintText(code, { filePath: 'src/lint-fixture.ts' });
    expect(results.flatMap((result) => result.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-syntax', severity: 2 }),
      ]),
    );
  });

  it.each(['react', 'react/jsx-runtime', 'react-native', 'react-native/Libraries',
    'expo', 'expo-location', 'expo-router/entry'])('RC-2 reports importing %s', async (source) => {
    const results = await eslint.lintText(`import '${source}';`, { filePath: 'src/lint-fixture.ts' });
    expect(results.flatMap((result) => result.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
      ]),
    );
  });

  it('RC-2 permits explicit instants and UTC arithmetic', async () => {
    const results = await eslint.lintText(
      'new Date(Date.UTC(2026, 9, 3)).getUTCDate(); new Date(0).getTime();',
      { filePath: 'src/lint-fixture.ts' },
    );
    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });

  it('RC-2 permits new Date(Date.UTC(2026, 0, 1))', async () => {
    const results = await eslint.lintText(
      'new Date(Date.UTC(2026, 0, 1));',
      { filePath: 'src/lint-fixture.ts' },
    );
    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });
});
