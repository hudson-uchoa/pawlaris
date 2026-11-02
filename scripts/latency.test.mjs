import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArguments, percentile, runLatency } from './latency.mjs';

const environment = {
  PAWLARIS_API_URL: 'https://box.example/api/v1',
  PAWLARIS_EMAIL: 'owner@example.invalid',
  PAWLARIS_PASSWORD: 'test-password',
  PAWLARIS_TASK_ID: '11111111-1111-4111-8111-111111111111',
};

async function withEnvironment(callback) {
  const previous = process.env.PAWLARIS_PASSWORD;
  process.env.PAWLARIS_PASSWORD = environment.PAWLARIS_PASSWORD;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.PAWLARIS_PASSWORD;
    else process.env.PAWLARIS_PASSWORD = previous;
  }
}

test('R5.9 parses the latency options and rejects malformed arguments', () => {
  assert.deepEqual(parseArguments([
    '--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--task-id', '11111111-1111-4111-8111-111111111111',
  ], { PAWLARIS_PASSWORD: environment.PAWLARIS_PASSWORD }), {
    url: 'https://box.example/api/v1', email: 'owner@example.invalid',
    password: 'test-password', taskId: '11111111-1111-4111-8111-111111111111',
  });
  for (const args of [[], ['--url'], ['--unknown', 'x'], ['--url', 'not a url'],
    ['--url', 'https://box.example/api/v1', '--url', 'https://other.example'],
    ['--password', 'test-password']]) {
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
    '--task-id', '11111111-1111-4111-8111-111111111111'];
  assert.equal(await withEnvironment(() => runLatency(args, source)), 0);
  const failing = { ...source, async request() {
    return { ok: true, status: 200, headers: { get: () => 'app;dur=100' },
      json: async () => ({ access_token: 'token', id: 'id', revision: 1, has_more: false }) };
  } };
  assert.equal(await withEnvironment(() => runLatency(args, failing)), 1);
});

test('R5.9 excludes login and cursor discovery, then measures incremental sync', async () => {
  const calls = [];
  let syncPages = 0;
  const source = {
    async request(path, init) {
      calls.push({ path, init });
      return { ok: true, status: 200, headers: { get: () => 'app;dur=99' },
        json: async () => path.includes('/auth/login') ? { access_token: 'token' }
          : path.includes('/sync') && path.includes('limit=1000')
            ? (++syncPages === 1 ? { revision: 41, has_more: true, changes: [] }
              : { revision: 42, has_more: false, changes: [] })
            : path.includes('/sync') ? { revision: 42, has_more: false, changes: [] }
            : { id: 'id' } };
    },
    now() { return '2026-11-03T12:00:00.000Z'; },
    output() {},
  };
  const args = ['--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--task-id', '11111111-1111-4111-8111-111111111111'];
  assert.equal(await withEnvironment(() => runLatency(args, source)), 0);
  assert.equal(calls.length, 603);
  assert.match(calls[0].path, /\/auth\/login$/);
  assert.match(calls[1].path, /\/sync\?since=0&limit=1000$/);
  assert.match(calls[2].path, /\/sync\?since=41&limit=1000$/);
  const completion = JSON.parse(calls[3].init.body);
  assert.equal(completion.occurrence_key, '2026-11-03');
  assert.match(calls[4].path, /\/completions\/id\/undo$/);
  assert.match(calls.at(-1).path, /\/sync\?since=42&limit=1$/);
  assert.equal(calls.at(-1).path, calls.at(-2).path);
});

test('R5.9 samples exactly 600 measured calls for the percentile', async () => {
  let measured = 0;
  const source = {
    async request(path) {
      const isLogin = path.includes('/auth/login');
      const isDiscovery = path.includes('limit=1000');
      const isMeasuredSync = path.includes('/sync?since=1&limit=1');
      const duration = !isLogin && !isDiscovery && !isMeasuredSync && measured++ < 30 ? 1000 : 99;
      return { ok: true, status: 200, headers: { get: () => isLogin ? 'app;dur=1000' : `app;dur=${duration}` },
        json: async () => path.includes('/auth/login') ? { access_token: 'token' }
          : path.includes('/sync') ? { revision: 1, has_more: false } : { id: 'id' } };
    },
    now() { return '2026-11-03T12:00:00.000Z'; },
    output(line) { assert.match(line, /p95 99 ms/); },
  };
  const args = ['--url', 'https://box.example/api/v1', '--email', 'owner@example.invalid',
    '--task-id', '11111111-1111-4111-8111-111111111111'];
  assert.equal(await withEnvironment(() => runLatency(args, source)), 0);
});
