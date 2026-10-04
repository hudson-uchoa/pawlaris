import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * @param {{path: string, before: string | null, after: string | null}[]} changes
 * @param {string} branch
 * @param {string | undefined} role
 * @returns {string[]}
 */
export function validateSpecChanges(changes, branch, role) {
  if (!branch.startsWith('phase/') || role === 'orchestrator') return [];
  return changes.filter(({ path, before, after }) => {
    if (!path.startsWith('spec/') || path === 'spec/QUESTIONS.md' ||
      path.startsWith('spec/contracts/')) return false;
    if (path !== 'spec/08-tasks.md' || before === null || after === null) return true;
    const oldLines = before.split('\n');
    const newLines = after.split('\n');
    if (oldLines.length !== newLines.length) return true;
    // Implementers may submit a task for review, never accept it or tick Device boxes.
    const taskCheckbox = /^- \[ \] \*\*P\d+-\d+ — /;
    return oldLines.some((line, index) => {
      const updated = newLines[index] ?? '';
      return line !== updated && (!taskCheckbox.test(line) ||
        updated !== line.replace('- [ ]', '- [~]'));
    });
  }).map(({ path }) => path);
}

/** @param {string[]} args @returns {string} */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const branch = git(['branch', '--show-current']).trim();
    if (branch.startsWith('phase/') && process.env.PAWLARIS_ROLE !== 'orchestrator') {
      const paths = git(['diff', '--cached', '--name-only', '--no-renames', '-z', '--', 'spec/'])
        .split('\0').filter(Boolean);
      const changes = paths.map((path) => {
        if (path !== 'spec/08-tasks.md') return { path, before: null, after: null };
        const beforeExists = git(['ls-tree', 'HEAD', '--', path]).trim() !== '';
        const afterExists = git(['ls-files', '--stage', '--', path]).trim() !== '';
        return { path, before: beforeExists ? git(['show', `HEAD:${path}`]) : null,
          after: afterExists ? git(['show', `:${path}`]) : null };
      });
      const errors = validateSpecChanges(changes, branch, process.env.PAWLARIS_ROLE);
      for (const path of errors) console.error(`guard-spec: protected staged change: ${path}`);
      process.exitCode = errors.length ? 1 : 0;
    }
  } catch (error) {
    console.error(`guard-spec: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
