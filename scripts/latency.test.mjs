import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArguments, percentile, runLatency } from './latency.mjs';

test('R5.9 parses the latency options and rejects malformed arguments', () => {
  assert.deepEqual(parseArguments([
    '--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--password', 'secret', '--task-id', '11111111-1111-4111-8111-111111111111',
  ]), {
    url: 'https://box.example/api/v1', email: 'owner@example.invalid',
    password: 'secret', taskId: '11111111-1111-4111-8111-111111111111',
  });
  for (const args of [[], ['--url'], ['--unknown', 'x'], ['--url', 'not a url'],
    ['--url', 'https://box.example/api/v1', '--url', 'https://other.example']]) {
    assert.throws(() => parseArguments(args), /usage|argument|option/i);
  }
});

test('R5.9 percentile uses the nearest-rank value', () => {
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
});

test('R5.9 p95 passes below 100 ms and fails at the strict boundary', async () => {
  const source = {
    async request(path) {
      return { ok: true, status: 200, headers: { get: () => 'app;dur=99' },
        json: async () => path === 'https://box.example/api/v1/auth/login'
          ? { access_token: 'token' } : path.includes('/sync')
            ? { revision: 1, has_more: false } : { id: 'id' } };
    },
    now() { return '2026-11-02T12:00:00.000Z'; },
    output() {},
  };
  const args = ['--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--password', 'secret', '--task-id', '11111111-1111-4111-8111-111111111111'];
  assert.equal(await runLatency(args, source), 0);
  const failing = { ...source, async request() {
    return { ok: true, status: 200, headers: { get: () => 'app;dur=100' },
      json: async () => ({ access_token: 'token', id: 'id', revision: 1, has_more: false }) };
  } };
  assert.equal(await runLatency(args, failing), 1);
});

test('R5.9 excludes login and cursor discovery, then measures incremental sync', async () => {
  const calls = [];
  const source = {
    async request(path, init) {
      calls.push({ path, init });
      return { ok: true, status: 200, headers: { get: () => 'app;dur=99' },
        json: async () => path.includes('/auth/login') ? { access_token: 'token' }
          : path.includes('/sync') ? { revision: 42, has_more: false, changes: [] }
            : { id: 'id' } };
    },
    now() { return '2026-11-03T12:00:00.000Z'; },
    output() {},
  };
  const args = ['--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--password', 'secret', '--task-id', '11111111-1111-4111-8111-111111111111'];
  assert.equal(await runLatency(args, source), 0);
  assert.equal(calls.length, 602);
  assert.match(calls[0].path, /\/auth\/login$/);
  assert.match(calls[1].path, /\/sync\?since=0&limit=1000$/);
  assert.equal(calls[2].init.body.includes('2026-11-03'), true);
  assert.match(calls.at(-1).path, /\/sync\?since=42&limit=1$/);
  assert.equal(calls.at(-1).path, calls.at(-2).path);
});

test('R5.9 a slow login does not affect the percentile', async () => {
  const source = {
    async request(path) {
      return { ok: true, status: 200, headers: { get: () => path.includes('/auth/login') ? 'app;dur=1000' : 'app;dur=99' },
        json: async () => path.includes('/auth/login') ? { access_token: 'token' }
          : path.includes('/sync') ? { revision: 1, has_more: false } : { id: 'id' } };
    },
    now() { return '2026-11-03T12:00:00.000Z'; },
    output(line) { assert.match(line, /p95 99 ms/); },
  };
  const args = ['--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--password', 'secret', '--task-id', '11111111-1111-4111-8111-111111111111'];
  assert.equal(await runLatency(args, source), 0);
});
