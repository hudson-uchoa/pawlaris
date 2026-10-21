import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse the mobile compiler; the guard adds no dependency to the app.
const require = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const ts = require('typescript');

/**
 * Return the lines containing JSX text literals with letters.
 * Test files and src/i18n are exempt; props and expressions are out of scope.
 * @param {string} path repository-relative file path
 * @param {string} text complete source text
 * @returns {number[]} one-based offending line numbers
 */
export function stringProblems(path, text) {
  if (!path.startsWith('apps/mobile/')
    || path.startsWith('apps/mobile/src/i18n/')
    || path.split('/').includes('__tests__')
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
  /** @type {Set<number>} */
  const lines = new Set();
  /** @param {import('../apps/mobile/node_modules/typescript').Node} node */
  function visit(node) {
    if (ts.isJsxText(node)) {
      const firstLine = source.getLineAndCharacterOfPosition(node.pos).line;
      node.text.split(/\r?\n/).forEach((line, index) => {
        if (/\p{L}/u.test(line)) lines.add(firstLine + index + 1);
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...lines].sort((a, b) => a - b);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // The standalone gate scans all tracked mobile source, as does --all.
    const paths = execFileSync('git', ['ls-files', '-z', '--', 'apps/mobile'],
      { encoding: 'utf8' }).split('\0').filter(Boolean);
    let failed = false;
    for (const path of paths) {
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(path))) continue;
      for (const line of stringProblems(path, readFileSync(path, 'utf8'))) {
        console.error(`guard-strings: ${path}:${line}: move JSX copy to i18n/strings.ts.`);
        failed = true;
      }
    }
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`guard-strings: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
