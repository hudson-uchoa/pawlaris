import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Return the lines containing numeric motion configuration literals.
 * Test files are scanned; only src/ui/motion/tokens.ts is exempt.
 * @param {string} path repository-relative file path
 * @param {string} text complete source text
 * @returns {number[]} one-based offending line numbers
 */
export function motionProblems(path, text) {
  void path;
  void text;
  throw new Error('not implemented');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // The standalone gate scans all tracked mobile source, as does --all.
    const paths = execFileSync('git', ['ls-files', '-z', '--', 'apps/mobile'],
      { encoding: 'utf8' }).split('\0').filter(Boolean);
    let failed = false;
    for (const path of paths) {
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(path))) continue;
      for (const line of motionProblems(path, readFileSync(path, 'utf8'))) {
        console.error(`guard-motion: ${path}:${line}: use a named motion token.`);
        failed = true;
      }
    }
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`guard-motion: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
