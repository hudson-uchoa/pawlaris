#!/usr/bin/env node
/**
 * Cross-reference check for the spec — CLAUDE.md "Changing the spec" step 4.
 * Every requirement, ADR, task, invariant, owner prerequisite and `06` section
 * that is cited must exist; no task may depend on a later one; no gate may use
 * `&&` (the dev shell is Windows PowerShell 5.1). Node built-ins only.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'AGENTS.md', 'CLAUDE.md', 'spec/README.md', 'spec/00-constitution.md',
  'spec/02-spec.md', 'spec/03-data-model.md', 'spec/04-api-contract.md',
  'spec/05-architecture.md', 'spec/06-ux-motion-spec.md', 'spec/07-test-harness.md',
  'spec/08-tasks.md', 'spec/09-screens.md', 'spec/10-client-sync.md',
];
const text = Object.fromEntries(FILES.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')]));
const all = Object.values(text).join('\n');
const errors = [];
const uniq = (it) => [...new Set(it)];
const matches = (s, re, group = 0) => [...s.matchAll(re)].map((m) => m[group]);

// 1. requirements
const reqDefined = new Set(matches(text['spec/02-spec.md'], /\*\*(R\d+\.\d+)\*\*/g, 1));
for (const [file, t] of Object.entries(text)) {
  for (const id of uniq(matches(t, /\bR\d+\.\d+\b/g))) {
    if (!reqDefined.has(id)) errors.push(`${file}: cites ${id}, which 02-spec.md does not define`);
  }
}

// 2. ADRs
const adrDefined = new Set(matches(text['spec/05-architecture.md'], /^### (ADR-\d{3})/gm, 1));
for (const id of uniq(matches(all, /ADR-\d{3}/g))) {
  if (!adrDefined.has(id)) errors.push(`cites ${id}, which 05-architecture.md does not define`);
}

// 3. tasks: existence, order, shape
const tasks = text['spec/08-tasks.md'];
const order = matches(tasks, /^- \[[ x~]\] \*\*(P\d-\d+)/gm, 1);
if (new Set(order).size !== order.length) errors.push('08-tasks.md: duplicate task id');
for (const id of uniq(matches(all, /\bP\d-\d+\b/g))) {
  if (!order.includes(id)) errors.push(`cites task ${id}, which 08-tasks.md does not define`);
}
const blocks = tasks.split(/^(?=- \[[ x~]\] \*\*P\d-\d+)/m).slice(1);
for (const block of blocks) {
  const id = block.match(/\*\*(P\d-\d+)/)[1];
  if (id === 'P0-1') continue;
  const dep = block.match(/\*\*Depends:\*\* ([^·\n]+)/);
  if (!dep) errors.push(`${id}: no Depends line`);
  for (const d of (dep?.[1].match(/P\d-\d+/g) ?? [])) {
    if (order.indexOf(d) >= order.indexOf(id)) errors.push(`${id}: depends on ${d}, which comes later`);
  }
  if (!/\*\*Gate:\*\*/.test(block)) errors.push(`${id}: no Gate`);
  const gate = block.match(/\*\*Gate:\*\*([^\n]*(?:\n(?!\s+\*\*)[^\n]*)*)/)?.[1] ?? '';
  if (gate.includes('&&')) errors.push(`${id}: Gate uses &&`);
}

// 4. invariants
const invDefined = new Set(matches(all, /> \*\*([A-Z]{2}-\d+)\*\*/g, 1));
const INV = /\b(?:SY|FM|ID|TK|RC|TZ|CP|TM|WK|AS|RB|WS|RP|OB|PL|SE|AF|MO)-\d+\b/g;
for (const id of uniq(matches(all, INV))) {
  if (!invDefined.has(id)) errors.push(`cites invariant ${id}, which is defined nowhere`);
}

// 5. owner prerequisites
const hDefined = new Set(matches(tasks, /^\| (H\d+) \|/gm, 1));
for (const id of uniq(matches(all, /\bH\d+\b/g))) {
  if (!hDefined.has(id)) errors.push(`cites prerequisite ${id}, which 08-tasks.md does not define`);
}

// 6. section references into 06 (the file whose numbering changed most)
const s06 = new Set(matches(text['spec/06-ux-motion-spec.md'], /^#{2,3} (\d+(?:\.\d+)?)\.? /gm, 1));
for (const [file, t] of Object.entries(text)) {
  if (file === 'spec/06-ux-motion-spec.md') continue;
  for (const m of t.matchAll(/`06` ((?:§\d+(?:\.\d+)?(?:–§?\d+(?:\.\d+)?)?(?: \([^)]*\))?(?:, )?)+)/g)) {
    for (const sec of matches(m[1], /§(\d+(?:\.\d+)?)/g, 1)) {
      if (!s06.has(sec)) errors.push(`${file}: cites 06 §${sec}, which does not exist`);
    }
  }
  for (const sec of matches(t, /\(06 §(\d+(?:\.\d+)?)\)/g, 1)) {
    if (!s06.has(sec)) errors.push(`${file}: cites 06 §${sec}, which does not exist`);
  }
}

if (errors.length) {
  console.error(`Spec cross-reference check failed (${errors.length}):`);
  for (const e of uniq(errors)) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `Spec references consistent: ${reqDefined.size} requirements, ${adrDefined.size} ADRs, ` +
  `${order.length} tasks, ${invDefined.size} invariants, ${hDefined.size} owner prerequisites.`,
);
