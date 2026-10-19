import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

// The repository is public (spec/07-test-harness.md §13): screenshots and
// recordings of the family's phones stay on the dev machine, under the
// git-ignored docs/evidence/media/. Only the app's own art and the concept
// screens are committed.
const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.bmp',
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp']);
const MEDIA_ALLOWED = ['apps/mobile/assets/', 'docs/screens/'];
const MAX_BYTES = 1024 * 1024;
const LAN_ADDRESS = /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;

/**
 * @param {string} path
 * @param {number} bytes
 * @param {string | null} text  the file's content when it is text, else null
 * @returns {string[]}
 */
export function contentProblems(path, bytes, text) {
  const problems = [];
  if (MEDIA.has(extname(path).toLowerCase()) && !MEDIA_ALLOWED.some((dir) => path.startsWith(dir))) {
    problems.push('screenshots and recordings stay local, in docs/evidence/media/');
  }
  if (bytes > MAX_BYTES) problems.push(`larger than 1 MB (${bytes} bytes)`);
  if (text !== null && LAN_ADDRESS.test(text)) problems.push('a LAN address; write <PC-LAN-IP>');
  return problems;
}

/** @param {Buffer} buffer @returns {string | null} */
function asText(buffer) {
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // --all checks every tracked file (the verify gate); otherwise the files
    // this commit adds or changes (the pre-commit hook).
    const args = process.argv.includes('--all')
      ? ['ls-files', '-z']
      : ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=AM', '-z'];
    const paths = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
    let failed = false;
    for (const path of paths) {
      if (path === 'pnpm-lock.yaml') continue;
      let buffer;
      try { buffer = readFileSync(path); } catch { continue; }
      for (const problem of contentProblems(path, statSync(path).size, asText(buffer))) {
        console.error(`guard-content: ${path}: ${problem}.`);
        failed = true;
      }
    }
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`guard-content: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
