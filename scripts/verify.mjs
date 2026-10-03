#!/usr/bin/env node
/**
 * Pawlaris harness runner — the single gate that decides "done".
 * See spec/07-test-harness.md. Node built-ins only, on purpose: the harness
 * must run before a single dependency is installed.
 *
 * Every gate is one of:
 *   PASS     the gate ran and succeeded
 *   FAIL     the gate ran and failed  -> fix the code
 *   PENDING  the gate's tooling does not exist yet -> implement its task
 *
 * PENDING is NOT success. Strict `verify` exits non-zero until every gate is
 * PASS; that is the release bar. A task is done when its own gate passes and
 * `verify --allow-pending` reports zero FAIL (spec/07-test-harness.md §1,
 * ADR-026): PENDING is then tolerated, FAIL never is.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{id:string,group:string,cmd:string,requires:string,task:string,spec:string}[]} */
const GATES = [
  // ---- fixtures (authored by the orchestrator) --------------------------
  { id: 'vectors',          group: 'fixtures',  task: 'spec', spec: '07 §3',
    requires: 'scripts/validate-vectors.mjs',
    cmd: 'node scripts/validate-vectors.mjs' },

  { id: 'spec-refs',        group: 'fixtures',  task: 'spec', spec: 'CLAUDE.md §Changing the spec',
    requires: 'scripts/check-spec.mjs',
    cmd: 'node scripts/check-spec.mjs' },

  // ---- packages/shared --------------------------------------------------
  { id: 'lint:shared',      group: 'lint',      task: 'P0-3', spec: '07 §2 / RC-2',
    requires: 'packages/shared/package.json',
    cmd: 'pnpm -C packages/shared run lint' },

  { id: 'typecheck:shared', group: 'typecheck', task: 'P0-3', spec: '05 §1 Shared',
    requires: 'packages/shared/tsconfig.json',
    cmd: 'pnpm -C packages/shared exec tsc --noEmit' },

  { id: 'test:shared',      group: 'test',      task: 'P0-3', spec: '07 §4',
    requires: 'packages/shared/package.json',
    cmd: 'pnpm -C packages/shared run test' },

  // ---- services/api -----------------------------------------------------
  { id: 'lint:api',         group: 'lint',      task: 'P0-4', spec: '07 §2',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api ruff check .' },

  { id: 'format:api',       group: 'lint',      task: 'P0-4', spec: '07 §2',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api ruff format --check .' },

  { id: 'typecheck:api',    group: 'typecheck', task: 'P0-4', spec: 'AGENTS.md §3',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api mypy app --strict' },

  { id: 'test:api',         group: 'test',      task: 'P0-4', spec: '07 §5',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api pytest -q --cov=app --cov-fail-under=85' },

  { id: 'contract-check',   group: 'contract',  task: 'P0-4', spec: '04 §16',
    requires: 'scripts/contract-check.mjs',
    cmd: 'node scripts/contract-check.mjs' },

  // ---- apps/mobile ------------------------------------------------------
  { id: 'lint:mobile',      group: 'lint',      task: 'P0-5', spec: '07 §2 / MO-2',
    requires: 'apps/mobile/package.json',
    cmd: 'pnpm -C apps/mobile run lint' },

  { id: 'typecheck:mobile', group: 'typecheck', task: 'P0-5', spec: 'AGENTS.md §3',
    requires: 'apps/mobile/tsconfig.json',
    cmd: 'pnpm -C apps/mobile exec tsc --noEmit' },

  { id: 'test:mobile',      group: 'test',      task: 'P0-5', spec: '07 §6, §7',
    requires: 'apps/mobile/package.json',
    cmd: 'pnpm -C apps/mobile run test' },

  // ---- security: census, role matrix, leak scan --------------------------
  { id: 'security',         group: 'security',  task: 'P2-5', spec: '04 §5 / RB-1, RB-2, ID-1',
    requires: 'services/api/tests/security/test_role_matrix.py',
    cmd: 'uv run --directory services/api pytest tests/security -q' },
];

// ---------------------------------------------------------------------------

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', g: '', y: '', d: '', b: '', x: '' };

const args = process.argv.slice(2);
// `--only` takes one gate id or a comma-separated list (PowerShell 5.1 has no `&&`).
// PowerShell reads an unquoted `a,b` as an array: through `pnpm.ps1` it arrives
// as one argument "a b", and straight to `node` as two. Accept all three shapes.
const only = listOf('--only');
const group = valueOf('--group');
const listOnly = args.includes('--list');
const allowPending = args.includes('--allow-pending');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function listOf(flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const rest = args.slice(i + 1);
  const end = rest.findIndex((a) => a.startsWith('--'));
  const values = end === -1 ? rest : rest.slice(0, end);
  return values.flatMap((v) => v.split(/[,\s]+/)).filter(Boolean);
}

const selected = GATES.filter(
  (g) => (!only || only.includes(g.id)) && (!group || g.group === group),
);

const unknown = (only ?? []).filter((id) => !GATES.some((g) => g.id === id));
if (unknown.length) {
  console.error(`Unknown gate id(s): ${unknown.join(', ')}. Known ids:\n  ${GATES.map((g) => g.id).join('\n  ')}`);
  process.exit(2);
}

if (selected.length === 0) {
  console.error(`No gate matched. Known ids:\n  ${GATES.map((g) => g.id).join('\n  ')}`);
  process.exit(2);
}

if (listOnly) {
  for (const g of selected) console.log(`${g.id.padEnd(18)} ${g.group.padEnd(10)} ${g.task}  ${g.spec}`);
  process.exit(0);
}

console.log(`\n${C.b}Pawlaris harness${C.x} ${C.d}— spec/07-test-harness.md${C.x}\n`);

const results = [];
for (const gate of selected) {
  const ready = existsSync(resolve(ROOT, gate.requires));
  if (!ready) {
    results.push({ ...gate, status: 'PENDING' });
    process.stdout.write(`  ${C.y}○${C.x} ${gate.id.padEnd(18)} ${C.d}pending — ${gate.task}${C.x}\n`);
    continue;
  }
  process.stdout.write(`  ${C.d}·${C.x} ${gate.id.padEnd(18)} ${C.d}running…${C.x}`);
  const started = Date.now();
  const proc = spawnSync(gate.cmd, { cwd: ROOT, shell: true, stdio: 'pipe', encoding: 'utf8' });
  const ms = Date.now() - started;
  const ok = proc.status === 0;
  results.push({ ...gate, status: ok ? 'PASS' : 'FAIL', ms, output: (proc.stdout || '') + (proc.stderr || '') });
  process.stdout.write(
    `\r  ${ok ? C.g + '✓' : C.r + '✗'}${C.x} ${gate.id.padEnd(18)} ${C.d}${ms} ms${C.x}          \n`,
  );
}

const failed = results.filter((r) => r.status === 'FAIL');
const pending = results.filter((r) => r.status === 'PENDING');
const passed = results.filter((r) => r.status === 'PASS');

for (const f of failed) {
  console.log(`\n${C.r}${C.b}FAIL${C.x} ${C.b}${f.id}${C.x}  ${C.d}(${f.spec})${C.x}`);
  console.log(`${C.d}$ ${f.cmd}${C.x}`);
  console.log((f.output || '').trim().split('\n').slice(-40).map((l) => '  ' + l).join('\n'));
}

console.log(`\n${C.b}─────────────────────────────────────────────${C.x}`);
console.log(
  `  ${C.g}${passed.length} pass${C.x}   ${C.r}${failed.length} fail${C.x}   ${C.y}${pending.length} pending${C.x}   ${C.d}of ${results.length}${C.x}`,
);

if (pending.length) {
  const byTask = new Map();
  for (const p of pending) {
    if (!byTask.has(p.task)) byTask.set(p.task, []);
    byTask.get(p.task).push(p.id);
  }
  console.log(allowPending
    ? `\n${C.y}Pending gates${C.x} ${C.d}(tolerated by --allow-pending; a release needs them all). Created by:${C.x}`
    : `\n${C.y}Pending gates are not success.${C.x} ${C.d}Implement, in backlog order:${C.x}`);
  for (const [task, ids] of [...byTask].sort()) {
    console.log(`  ${C.b}${task}${C.x}  ${C.d}→${C.x} ${ids.join(', ')}   ${C.d}(spec/08-tasks.md)${C.x}`);
  }
}

if (failed.length === 0 && pending.length === 0) {
  console.log(`\n${C.g}${C.b}All gates green.${C.x}\n`);
  process.exit(0);
}

if (failed.length === 0 && allowPending) {
  console.log(`\n${C.g}${C.b}No failures.${C.x} ${C.d}Task bar met (--allow-pending); not a release.${C.x}\n`);
  process.exit(0);
}

console.log('');
process.exit(1);
