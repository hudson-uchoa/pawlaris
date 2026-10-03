import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** @param {string} message @param {string} branch @returns {string[]} */
export function validateCommitMessage(message, branch) {
  const lines = message.replaceAll('\r\n', '\n').trimEnd().split('\n');
  const first = lines[0] ?? '';
  if (/^Merge (?:branch |remote-tracking branch |tag |commit |pull request )/.test(first) ||
    (/^Revert ".+"$/.test(first) &&
      lines.some((line) => /^This reverts commit [a-f0-9]{40,64}\.$/.test(line)))) {
    return [];
  }
  const header = /^([a-z]+)\(([^()]+)\)!?: (.*)$/.exec(first);
  if (!header) return ['Use a Conventional Commits header: type(scope): subject.'];
  const errors = [];
  if (!['feat', 'fix', 'test', 'refactor', 'perf', 'docs', 'build', 'ci', 'chore',
    'revert'].includes(header[1] ?? '')) errors.push('Use an allowed commit type.');
  if (!['shared', 'api', 'mobile', 'infra', 'harness', 'spec', 'docs', 'repo']
    .includes(header[2] ?? '')) errors.push('Use an allowed commit scope.');
  if ([...first].length > 72) errors.push('The first line must be at most 72 characters.');
  const subject = header[3] ?? '';
  if (!subject.trim()) errors.push('The subject must not be empty.');
  else if (!/^[a-z]/.test(subject)) errors.push('The subject must start lower-case.');
  if (subject.trimEnd().endsWith('.')) errors.push('The subject must have no trailing period.');
  if (lines.length > 1 && lines[1] !== '') errors.push('Put a blank line before the body.');
  for (const [index, line] of lines.entries()) {
    if (index > 0 && [...line].length > 72 && !/^\s/.test(line) && !/https?:\/\/\S+/.test(line)) {
      errors.push(`The body line ${index + 1} must be at most 72 characters.`);
    }
  }
  if (branch.startsWith('phase/')) {
    const lastBlock = lines.slice(lines.lastIndexOf('') + 1);
    const taskIndex = lastBlock.findIndex((line) => /^Task: P\d+-\d+$/.test(line));
    const trailer = /^(?:[A-Za-z][A-Za-z -]*: \S.*|[ \t]+\S.*)$/;
    if (taskIndex < 0 || lastBlock.slice(taskIndex + 1).some((line) => !trailer.test(line))) {
      errors.push('A phase commit requires a Task: P<n>-<n> footer.');
    }
    else if (lastBlock.some((line) => !trailer.test(line))) {
      errors.push('Separate the footer block from the body with a blank line.');
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Pass the commit message file.');
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
    const errors = validateCommitMessage(readFileSync(file, 'utf8'), branch);
    for (const error of errors) console.error(`guard-commit-msg: ${error}`);
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(`guard-commit-msg: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
