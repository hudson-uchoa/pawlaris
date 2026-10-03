#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'spec/contracts/openapi.json');
const exported = spawnSync('uv', [
  'run', '--directory', 'services/api', 'python', '-m', 'app.export_openapi',
], { cwd: root, encoding: 'utf8' });

if (exported.status !== 0) {
  console.error('OpenAPI exporter failed.');
  process.exit(1);
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

const canonical = JSON.stringify(sorted(JSON.parse(exported.stdout)), null, 2) + '\n';
if (process.argv.includes('--freeze')) {
  writeFileSync(target, canonical);
  console.log('OpenAPI contract frozen.');
} else {
  let committed;
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    console.error('OpenAPI contract missing. Run pnpm contract-freeze and pnpm types.');
    process.exit(1);
  }
  if (committed !== canonical) {
    console.error('OpenAPI contract drift. Run pnpm contract-freeze and pnpm types.');
    process.exit(1);
  }
  console.log('OpenAPI contract matches.');
}
