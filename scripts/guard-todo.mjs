import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} path @param {string} diff @returns {number[]} */
export function unreferencedTodos(path, diff) {
  if (path.startsWith('spec/') || !['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.sh', '.ps1', '.sql'].includes(extname(path))) return [];
  const errors = [];
  let lineNumber = 0;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
    } else if (lineNumber > 0 && line.startsWith('+')) {
      if (/\b(?:TO[D]O|FIX[M]E)\b/.test(line) && !/\(#\d+\)/.test(line)) errors.push(lineNumber);
      lineNumber += 1;
    } else if (lineNumber > 0 && line.startsWith(' ')) lineNumber += 1;
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const paths = execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'],
      { encoding: 'utf8' }).split('\0').filter(Boolean);
    let failed = false;
    for (const path of paths) {
      const diff = execFileSync('git', ['diff', '--cached', '--no-ext-diff', '--no-renames',
        '--unified=0', '--', path], { encoding: 'utf8' });
      for (const line of unreferencedTodos(path, diff)) {
        console.error(`guard-todo: ${path}:${line}: add an issue reference (#<number>).`);
        failed = true;
      }
    }
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`guard-todo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
