#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const MAESTRO = 'C:/Tools/maestro/bin/maestro.bat';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERIAL = /^[\w][\w.:-]*$/;
const FLOWS = ['a-complete', 'b-observe'];

/** @param {string[]} args */
export function parseArguments(args) {
  if (args.length !== 2 || args.some((arg) => !SERIAL.test(arg)) || args[0] === args[1]) {
    throw new Error('Usage: e2e-two-device.mjs <serialA> <serialB>; use distinct serials');
  }
  return args;
}

/** @param {string} serial @param {string} flow @param {string} url */
export function flowCommand(serial, flow, url) {
  if (!SERIAL.test(serial) || !FLOWS.includes(flow) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
    throw new Error('Invalid flow command');
  }
  const reports = `docs/evidence/media/P7-5/${flow}`;
  return { file: MAESTRO, args: ['--device', serial, 'test', '-e', `COORDINATOR=${url}`,
    `apps/mobile/.maestro/two-device/${flow}.yaml`,
    '--test-output-dir', reports, '--debug-output', reports] };
}

/** @param {string} name @param {() => number} now */
export function createMeasurement(name, now) {
  let started, observed;
  return {
    start() {
      if (started !== undefined) throw new Error('Duplicate start');
      started = now();
      if (!Number.isFinite(started)) throw new Error('Invalid clock');
    },
    observe(label) {
      if (started === undefined) throw new Error('Missing start');
      if (observed !== undefined) throw new Error('Duplicate observation');
      if (typeof label !== 'string' || !label.startsWith(`${name} \u00b7 `)
        || !/^\d{2}:\d{2}$/.test(label.slice(name.length + 3))) throw new Error('Wrong completion name or time');
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid clock');
      observed = { pass: elapsed <= 3000, elapsed };
      return observed;
    },
    result() {
      if (observed === undefined) throw new Error('Missing completion observation');
      return observed;
    },
  };
}

// All timing comes from the injected monotonic clock. The handshake excludes
// process startup. Starting before A's tap and ending after B reads the label
// gives a conservative upper bound; no negative overhead is subtracted.
export function createProtocol(config, measurement) {
  let ready = false, startRequested = false, failure;
  let releaseA, releaseB;
  const a = new Promise((resolve) => { releaseA = resolve; });
  const b = new Promise((resolve) => { releaseB = resolve; });
  function release() {
    if (ready && startRequested) { measurement.start(); releaseA(); releaseB(); }
  }
  return {
    async request(method, path, body = '') {
      try {
        if (method === 'GET' && path === '/config') return config;
        if (method === 'GET' && path === '/ready' && !ready) {
          ready = true; release(); await b; return { ready: true };
        }
        if (method === 'GET' && path === '/start' && !startRequested) {
          startRequested = true; release(); await a; return { started: true };
        }
        if (method === 'POST' && path === '/observed' && ready) {
          return measurement.observe(JSON.parse(body).label);
        }
        throw new Error('Invalid coordinator event');
      } catch (error) { failure = error; throw error; }
    },
    result() { if (failure) throw failure; return measurement.result(); },
  };
}

export async function runTwoDevice(args, source = productionSources()) {
  const serials = parseArguments(args);
  const { taskId, occurrenceKey, completerName } = source.config;
  if (typeof taskId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/.test(taskId)
    || typeof occurrenceKey !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(occurrenceKey)
    || typeof completerName !== 'string' || !completerName.trim() || completerName.length > 40) {
    throw new Error('Set E2E_TASK_ID, E2E_OCCURRENCE_KEY and E2E_COMPLETER_NAME for the test family');
  }
  const measurement = createMeasurement(completerName, source.now);
  const coordinator = await source.coordinate(source.config, measurement);
  try {
    const outcomes = await Promise.allSettled(FLOWS.map((flow, index) => {
      const { file, args: commandArgs } = flowCommand(serials[index], flow, coordinator.url);
      return source.command(file, commandArgs);
    }));
    if (outcomes.some((outcome) => outcome.status === 'rejected')) {
      throw new Error('Maestro flow failed; inspect local P7-5 reports');
    }
    const { pass, elapsed } = coordinator.result();
    source.output(`${pass ? 'PASS' : 'FAIL'} R5.8 completion and name: ${elapsed.toFixed(1)} ms; budget <= 3000 ms`);
    return pass ? 0 : 1;
  } finally { await coordinator.close(); }
}

async function coordinate(config, measurement) {
  const protocol = createProtocol(config, measurement);
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) throw new Error('Coordinator body too large');
      }
      const result = await protocol.request(request.method, request.url, body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(400);
      response.end('Invalid coordinator event');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Coordinator did not bind');
  return { url: `http://127.0.0.1:${address.port}`, result: protocol.result,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

function productionSources() {
  const execute = promisify(execFile);
  return {
    config: { taskId: process.env.E2E_TASK_ID, occurrenceKey: process.env.E2E_OCCURRENCE_KEY,
      completerName: process.env.E2E_COMPLETER_NAME },
    now: () => performance.now(), coordinate, output: (line) => console.log(line),
    async command(file, args) {
      // Only fixed flow paths, validated serials and the loopback URL enter cmd.
      if (args.some((arg) => !/^[\w./:=\-]+$/.test(arg))) throw new Error('Invalid Maestro argument');
      const line = `""${file}" ${args.map((arg) => `"${arg}"`).join(' ')}"`;
      try {
        await execute('cmd.exe', ['/d', '/s', '/c', line], { cwd: ROOT, windowsHide: true,
          windowsVerbatimArguments: true, timeout: 120_000, maxBuffer: 16 * 1024 ** 2,
          env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' } });
      } catch { throw new Error('Maestro flow failed'); }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runTwoDevice(process.argv.slice(2)); }
  catch (error) {
    console.error(`e2e: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
