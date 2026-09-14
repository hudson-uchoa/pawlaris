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
 * PENDING is NOT success. `verify` exits non-zero until every gate is PASS,
 * which is what makes the backlog in spec/08-tasks.md self-enforcing.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{id:string,group:string,cmd:string,requires:string,task:string,spec:string}[]} */
const GATES = [
  // ---- static analysis -------------------------------------------------
  { id: 'lint:mobile',      group: 'lint',      task: 'P0-2', spec: '07 §Layers',
    requires: 'apps/mobile/package.json',
    cmd: 'pnpm -C apps/mobile run lint' },

  { id: 'typecheck:mobile', group: 'typecheck', task: 'P0-2', spec: '00 P2 / CLAUDE.md',
    requires: 'apps/mobile/tsconfig.json',
    cmd: 'pnpm -C apps/mobile exec tsc --noEmit' },

  { id: 'typecheck:shared', group: 'typecheck', task: 'P1-2', spec: '05 §Shared',
    requires: 'packages/shared/tsconfig.json',
    cmd: 'pnpm -C packages/shared exec tsc --noEmit' },

  { id: 'lint:api',         group: 'lint',      task: 'P0-4', spec: '07 §Layers',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api ruff check .' },

  { id: 'format:api',       group: 'lint',      task: 'P0-4', spec: '07 §Layers',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api ruff format --check .' },

  { id: 'typecheck:api',    group: 'typecheck', task: 'P0-4', spec: '00 P2 / CLAUDE.md',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api mypy app --strict' },

  // ---- tests -----------------------------------------------------------
  { id: 'test:shared',      group: 'test',      task: 'P1-2', spec: '07 Gate 1',
    requires: 'packages/shared/package.json',
    cmd: 'pnpm -C packages/shared run test' },

  { id: 'test:mobile',      group: 'test',      task: 'P0-2', spec: '07 Gate 5',
    requires: 'apps/mobile/package.json',
    cmd: 'pnpm -C apps/mobile run test' },

  { id: 'test:api',         group: 'test',      task: 'P0-4', spec: '07 Gate 3',
    requires: 'services/api/pyproject.toml',
    cmd: 'uv run --directory services/api pytest -q' },

  // ---- the gates that make this project specifically correct -----------
  { id: 'vectors',          group: 'parity',    task: 'P1-1', spec: '07 Gate 1 / RC-1',
    requires: 'scripts/validate-vectors.mjs',
    cmd: 'node scripts/validate-vectors.mjs' },

  { id: 'parity',           group: 'parity',    task: 'P1-4', spec: '07 Gate 1 / RC-1',
    requires: 'scripts/assert-parity.mjs',
    cmd: 'node scripts/assert-parity.mjs' },

  { id: 'contract-check',   group: 'contract',  task: 'P1-5', spec: '07 Gate 2',
    requires: 'services/api/app/export_openapi.py',
    cmd: 'node scripts/contract-check.mjs' },

  { id: 'security',         group: 'security',  task: 'P2-5', spec: '07 Gate 4',
    requires: 'services/api/tests/security',
    cmd: 'uv run --directory services/api pytest tests/security -q' },

  { id: 'roles',            group: 'security',  task: 'P2-7', spec: '07 Gate 4 / RB-1',
    requires: 'services/api/tests/security/test_role_matrix.py',
    cmd: 'uv run --directory services/api pytest tests/security/test_role_matrix.py -q' },
];

// ---------------------------------------------------------------------------

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', g: '', y: '', d: '', b: '', x: '' };

const args = process.argv.slice(2);
const only = valueOf('--only');
const group = valueOf('--group');
const listOnly = args.includes('--list');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const selected = GATES.filter(
  (g) => (!only || g.id === only) && (!group || g.group === group),
);

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
  console.log(`\n${C.y}Pending gates are not success.${C.x} ${C.d}Implement, in backlog order:${C.x}`);
  for (const [task, ids] of [...byTask].sort()) {
    console.log(`  ${C.b}${task}${C.x}  ${C.d}→${C.x} ${ids.join(', ')}   ${C.d}(spec/08-tasks.md)${C.x}`);
  }
}

if (failed.length === 0 && pending.length === 0) {
  console.log(`\n${C.g}${C.b}All gates green.${C.x} This is the only condition under which a task is done.\n`);
  process.exit(0);
}

console.log('');
process.exit(1);
