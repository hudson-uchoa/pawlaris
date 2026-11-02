#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const COUNT = 200;
const USAGE = 'Usage: latency.mjs [--url <url>] [--email <email>] [--password <password>] '
  + '[--task-id <uuid>]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
export function parseArguments(args, env = process.env) {
  const values = {
    url: env.PAWLARIS_API_URL,
    email: env.PAWLARIS_EMAIL,
    password: env.PAWLARIS_PASSWORD,
    taskId: env.PAWLARIS_TASK_ID,
  };
  const names = { url: 'url', email: 'email', password: 'password', 'task-id': 'taskId' };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    const name = key === undefined ? undefined : names[key];
    const value = args[index + 1];
    if (name === undefined || value === undefined || value.startsWith('--') || values[name] !== undefined) {
      throw new Error(`Invalid argument. ${USAGE}`);
    }
    values[name] = value;
  }
  if (!values.url || !values.email || !values.password || !values.taskId) throw new Error(USAGE);
  let url;
  try { url = new URL(values.url); } catch { throw new Error(`Invalid URL. ${USAGE}`); }
  if (!['http:', 'https:'].includes(url.protocol) || !UUID.test(values.taskId)) throw new Error(USAGE);
  return { url: values.url.replace(/\/$/, ''), email: values.email, password: values.password, taskId: values.taskId };
}

/** @param {number[]} values @param {number} quantile */
export function percentile(values, quantile) {
  if (values.length === 0 || quantile < 0 || quantile > 1) throw new Error('Invalid percentile');
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(quantile * ordered.length) - 1)];
}

function timing(response) {
  const value = response.headers.get('server-timing');
  const match = value?.match(/(?:^|,)\s*app;dur=([0-9]+(?:\.[0-9]+)?)/);
  if (!match) throw new Error('Missing Server-Timing app duration');
  const milliseconds = Number(match[1]);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid Server-Timing app duration');
  return milliseconds;
}

/** @param {string[]} args @param {{request: Function, now: () => string, output: (line: string) => void}} source */
export async function runLatency(args, source = productionSource()) {
  const options = parseArguments(args);
  const samples = [];
  const request = async (path, init) => {
    const response = await source.request(`${options.url}${path}`, init);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    samples.push(timing(response));
    return response;
  };
  const login = await request('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: options.email, password: options.password }),
  });
  const session = await login.json();
  if (typeof session.access_token !== 'string') throw new Error('Login returned no access token');
  const auth = { authorization: `Bearer ${session.access_token}` };
  for (let index = 0; index < COUNT; index += 1) {
    const id = randomUUID();
    const completion = await request('/completions', {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': id },
      body: JSON.stringify({ id, task_id: options.taskId, occurrence_key: '2026-11-02T12:00',
        completed_at: source.now(), pet_id: null, photo_asset_id: null, note: null }),
    });
    const row = await completion.json();
    if (typeof row.id !== 'string') throw new Error('Completion returned no id');
    await request(`/completions/${row.id}/undo`, {
      method: 'POST', headers: { ...auth, 'idempotency-key': randomUUID() },
    });
  }
  for (let index = 0; index < COUNT; index += 1) {
    await request('/sync?since=0&limit=1', { headers: auth });
  }
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const pass = p95 < 100;
  source.output(`${pass ? 'PASS' : 'FAIL'} latency: p50 ${p50} ms, p95 ${p95} ms; budget p95 < 100 ms`);
  return pass ? 0 : 1;
}

function productionSource() {
  return { request: globalThis.fetch, now: () => new Date().toISOString(), output: (line) => console.log(line) };
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  try { process.exitCode = await runLatency(process.argv.slice(2)); }
  catch (error) { console.error(`latency: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}

