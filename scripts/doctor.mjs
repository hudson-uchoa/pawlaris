#!/usr/bin/env node
/** Toolchain diagnostic for P0-2. Node built-ins only; never print env values. */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let hasFindings = false;

/**
 * @param {string} name
 * @param {'OK' | 'MISSING' | 'WRONG VERSION'} status
 * @param {string} detail
 * @param {string} task
 */
function report(name, status, detail, task) {
  hasFindings ||= status !== 'OK';
  console.log(`${status.padEnd(13)} ${name}: ${detail} — needed by ${task}`);
}

const tools = [
  { name: 'node', command: 'node --version', pattern: /^v(\d+\.\d+\.\d+)/m,
    major: 22, minimum: true, task: 'P0-2' },
  { name: 'pnpm', command: 'pnpm --version', pattern: /^(\d+\.\d+\.\d+)\b/m,
    task: 'P0-3' },
  { name: 'git', command: 'git --version', pattern: /\bgit version (\d+(?:\.\d+)+)/,
    task: 'P0-1' },
  { name: 'uv', command: 'uv --version', pattern: /\buv (\d+(?:\.\d+)+)/,
    task: 'P0-4' },
  { name: 'python', command: 'python --version', pattern: /\bPython (\d+\.\d+\.\d+)/,
    major: 3, minor: 12, task: 'P0-4' },
  { name: 'psql', command: 'psql --version', pattern: /\(PostgreSQL\) (\d+(?:\.\d+)*)/,
    major: 16, task: 'P0-4' },
  { name: 'java', command: 'java -version', pattern: /\b(?:openjdk|java) version "([^"\r\n]+)"/,
    major: 17, task: 'P0-6' },
  { name: 'adb', command: 'adb version', pattern: /Android Debug Bridge version (\d+(?:\.\d+)+)/,
    task: 'P0-6' },
  { name: 'maestro', command: 'maestro --version', pattern: /^(\d+\.\d+\.\d+)\b/m,
    task: 'P7-4' },
];

for (const tool of tools) {
  // These are fixed commands, never assembled from environment values. The
  // shell resolves Windows .cmd launchers without invoking PowerShell .ps1.
  const result = spawnSync(tool.command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const output = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
  const version = output.match(tool.pattern)?.[1];
  if (result.error || result.status !== 0) {
    report(tool.name, 'MISSING', version ?? 'version unavailable', tool.task);
    continue;
  }
  if (!version) {
    report(tool.name, 'WRONG VERSION', 'version unrecognized', tool.task);
    continue;
  }
  const [major, minor] = version.split('.').map(Number);
  const matches = tool.major === undefined
    || ((tool.minimum ? major >= tool.major : major === tool.major)
      && (tool.minor === undefined || minor === tool.minor));
  report(tool.name, matches ? 'OK' : 'WRONG VERSION', version, tool.task);
}

/** @param {string} path */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function databaseUrlInFile() {
  let contents;
  try {
    contents = readFileSync(resolve(ROOT, 'services/api/.env'), 'utf8');
  } catch {
    return false;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?TEST_DATABASE_URL\s*=\s*(.*)$/);
    if (!match) continue;
    const raw = match[1].trim();
    const quoted = raw.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
    const value = quoted ? quoted[2] : raw.replace(/(?:^|\s)#.*$/, '').trim();
    if (value.trim()) return true;
  }
  return false;
}

const databaseSource = process.env.TEST_DATABASE_URL?.trim()
  ? 'set in environment'
  : databaseUrlInFile() ? 'set in services/api/.env' : null;
report('TEST_DATABASE_URL', databaseSource ? 'OK' : 'MISSING',
  databaseSource ?? 'not set in environment or services/api/.env', 'P0-4');

const androidHome = process.env.ANDROID_HOME;
const sdkReady = Boolean(androidHome && isDirectory(androidHome)
  && (isDirectory(resolve(androidHome, 'platform-tools'))
    || isDirectory(resolve(androidHome, 'platforms'))));
report('ANDROID_HOME', sdkReady ? 'OK' : 'MISSING',
  sdkReady ? 'SDK directory contains platform-tools or platforms'
    : 'SDK directory missing or contains neither platform-tools nor platforms', 'P0-6');

report('repository path', ROOT.includes(' ') ? 'WRONG VERSION' : 'OK',
  ROOT.includes(' ') ? 'contains a space' : 'contains no spaces', 'P0-6');
report('ANDROID_HOME path', !androidHome ? 'MISSING'
  : androidHome.includes(' ') ? 'WRONG VERSION' : 'OK',
  !androidHome ? 'not set' : androidHome.includes(' ')
    ? 'contains a space' : 'contains no spaces', 'P0-6');

// Q-1: strict mode treats every non-OK check as a readiness failure.
process.exitCode = process.argv.includes('--strict') && hasFindings ? 1 : 0;
