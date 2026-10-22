declare const __dirname: string;
const ts = jest.requireActual<typeof import('typescript')>('typescript');
const { readFileSync, readdirSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): {
    name: string; isDirectory(): boolean;
  }[];
}>('node:fs');
const { resolve } = jest.requireActual<{ resolve(...paths: string[]): string }>('node:path');

function sources(directory: string): string[] {
  return readdirSync(resolve(__dirname, '..', directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return ['__tests__', 'testing'].includes(entry.name) ? [] : sources(path);
      return /\.tsx?$/.test(path) ? [path] : [];
    });
}

test('P7-3 ADR-036 09 sections 2.1 and 7 are the only signature placements and use one mark module', () => {
  const imports: Record<string, string[]> = { PoweredBy: [], insurgeMark: [], PawStarMark: [] };
  for (const path of [...sources('app'), ...sources('src')]) {
    const source = ts.createSourceFile(path, readFileSync(resolve(__dirname, '..', path), 'utf8'),
      ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        || node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const name = node.moduleSpecifier.text.split('/').pop();
      if (name !== undefined && name in imports) imports[name]?.push(path);
    }
  }
  expect(imports).toEqual({
    PoweredBy: ['src/features/auth/LoginScreen.tsx', 'src/features/settings/SettingsScreen.tsx'],
    insurgeMark: ['src/ui/cosmos/PoweredBy.tsx'],
    PawStarMark: ['src/features/auth/LoginScreen.tsx'],
  });
});

test('P7-3 ADR-036 no other production module draws the Insurge glyph or spells out the signature', () => {
  const drawings: string[] = [];
  const wording: string[] = [];
  for (const path of [...sources('app'), ...sources('src')]) {
    const text = readFileSync(resolve(__dirname, '..', path), 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    function visit(node: import('typescript').Node) {
      if (ts.isPropertyAccessExpression(node)) {
        const owner = node.expression.getText(source);
        if (owner === 'insurgeMark') drawings.push(path);
        if (owner === 'strings.brand') wording.push(path);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect([...new Set(drawings)]).toEqual(['src/ui/cosmos/insurgeMark.tsx']);
  expect([...new Set(wording)]).toEqual(['src/ui/cosmos/PoweredBy.tsx']);
});
