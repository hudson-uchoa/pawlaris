import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeasurement, createProtocol, flowCommand, MAESTRO, parseArguments, runTwoDevice } from './e2e-two-device.mjs';

test('P7-5 validates exactly two distinct safe device serials', () => {
  assert.deepEqual(parseArguments(['phone-a', 'phone-b']), ['phone-a', 'phone-b']);
  for (const args of [[], ['a'], ['a', 'b', 'c'], ['a', 'a'], ['', 'b'],
    ['--device', 'b'], ['a&whoami', 'b'], ['a"', 'b'], ['a b', 'b'], ['a%', 'b']]) {
    assert.throws(() => parseArguments(args), /serial|Usage/);
  }
});

test('P7-5 command lines use the installed launcher, device and separate reports', () => {
  for (const [flow, serial] of [['a-complete', 'phone-a'], ['b-observe', 'phone-b']]) {
    assert.deepEqual(flowCommand(serial, flow, 'http://127.0.0.1:4321'), {
      file: MAESTRO,
      args: ['--device', serial, 'test', '-e', 'COORDINATOR=http://127.0.0.1:4321',
        `apps/mobile/.maestro/two-device/${flow}.yaml`,
        '--test-output-dir', `docs/evidence/media/P7-5/${flow}`,
        '--debug-output', `docs/evidence/media/P7-5/${flow}`],
    });
  }
  assert.throws(() => flowCommand('a', '../bad', 'http://127.0.0.1:4321'));
});

test('R5.8 measures the start-to-observation boundary: 2999 and 3000 pass; 3001 fails', () => {
  for (const [elapsed, pass] of [[2999, true], [3000, true], [3001, false]]) {
    let time = 100;
    const measurement = createMeasurement('Tester A', () => time);
    measurement.start();
    time += elapsed;
    const result = measurement.observe('Tester A · 08:02');
    assert.deepEqual(result, { pass, elapsed });
    assert.deepEqual(measurement.result(), result);
  }
});

test('R5.8 missing, stale, duplicate, wrong-name and invalid-clock observations cannot pass', () => {
  let time = 10;
  const measurement = createMeasurement('Tester A', () => time);
  assert.throws(() => measurement.result(), /observation/);
  assert.throws(() => measurement.observe('Tester A · 08:02'), /start/);
  measurement.start();
  assert.throws(() => measurement.start(), /start/);
  assert.throws(() => measurement.observe('Tester B · 08:02'), /name/);
  assert.throws(() => measurement.observe('Tester Another · 08:02'), /name/);
  time = 9;
  assert.throws(() => measurement.observe('Tester A · 08:02'), /clock/);
  time = 11;
  measurement.observe('Tester A · 08:02');
  assert.throws(() => measurement.observe('Tester A · 08:02'), /observation/);
});

function fake({ elapsed = 1000, fail, missing = false } = {}) {
  const commands = [], lines = [];
  let closed = false;
  return { commands, lines, get closed() { return closed; },
    config: { taskId: '12345678-1234-4234-8234-123456789abc', occurrenceKey: '2026-10-22', completerName: 'Tester A' },
    now: () => 0,
    output: (line) => lines.push(line),
    async coordinate(config, measurement) {
      return { url: 'http://127.0.0.1:4321', close: async () => { closed = true; },
        result: () => {
          if (missing) return measurement.result();
          return { pass: elapsed <= 3000, elapsed };
        } };
    },
    async command(file, args) {
      commands.push({ file, args });
      if (fail && args.some((arg) => arg.endsWith(`${fail}.yaml`))) throw new Error('flow failed');
    },
  };
}

test('R5.8 starts both flows, reports elapsed time, and closes the coordinator', async () => {
  const source = fake();
  assert.equal(await runTwoDevice(['phone-a', 'phone-b'], source), 0);
  assert.equal(source.commands.length, 2);
  assert.deepEqual(source.commands[0], flowCommand('phone-a', 'a-complete', 'http://127.0.0.1:4321'));
  assert.deepEqual(source.commands[1], flowCommand('phone-b', 'b-observe', 'http://127.0.0.1:4321'));
  assert.match(source.lines.at(-1), /PASS.*1000.*3000/);
  assert.equal(source.closed, true);
  assert.ok(!source.lines.join('\n').includes('phone-a'));
});

test('R5.8 fails when either flow fails, even with a passing measurement', async () => {
  for (const fail of ['a-complete', 'b-observe']) {
    const source = fake({ fail });
    await assert.rejects(() => runTwoDevice(['phone-a', 'phone-b'], source), /flow/);
    assert.equal(source.closed, true);
    assert.ok(!source.lines.some((line) => line.startsWith('PASS')));
  }
});

test('R5.8 runner rejects a late or missing observation and invalid setup', async () => {
  const source = fake({ elapsed: 3001 });
  assert.equal(await runTwoDevice(['a', 'b'], source), 1);
  assert.match(source.lines.at(-1), /FAIL/);
  const missing = fake({ missing: true });
  await assert.rejects(() => runTwoDevice(['a', 'b'], missing), /observation/);
  for (const config of [{}, { ...source.config, taskId: 'bad' },
    { ...source.config, occurrenceKey: 'bad' }, { ...source.config, completerName: '' }]) {
    await assert.rejects(() => runTwoDevice(['a', 'b'], { ...fake(), config }), /E2E_/);
  }
});

test('R5.8 handshake excludes startup and releases only when both phones are ready', async () => {
  for (const first of ['/ready', '/start']) {
    let time = 0, released = false;
    const config = fake().config;
    const measurement = createMeasurement(config.completerName, () => time);
    const protocol = createProtocol(config, measurement);
    assert.deepEqual(await protocol.request('GET', '/config'), config);
    const pending = protocol.request('GET', first).then(() => { released = true; });
    await Promise.resolve();
    assert.equal(released, false);
    time = 90_000;
    await protocol.request('GET', first === '/ready' ? '/start' : '/ready');
    await pending;
    assert.equal(released, true);
    time += 3000;
    assert.deepEqual(await protocol.request('POST', '/observed', JSON.stringify({ label: 'Tester A · 08:02' })),
      { pass: true, elapsed: 3000 });
    assert.deepEqual(protocol.result(), { pass: true, elapsed: 3000 });
  }
});

test('R5.8 invalid coordinator events and wrong names remain fatal', async () => {
  for (const [method, path, body] of [
    ['GET', '/other', ''], ['POST', '/observed', '{'],
    ['POST', '/observed', JSON.stringify({ label: 'Tester B · 08:02' })],
    ['GET', '/ready', ''], ['GET', '/start', ''],
  ]) {
    const protocol = createProtocol(fake().config, createMeasurement('Tester A', () => 1));
    await Promise.all([protocol.request('GET', '/ready'), protocol.request('GET', '/start')]);
    await assert.rejects(() => protocol.request(method, path, body));
    assert.throws(() => protocol.result());
  }
});
