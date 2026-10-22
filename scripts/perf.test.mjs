import assert from 'node:assert/strict';
import test from 'node:test';
import { activityStartMetrics, frameMetrics, memoryMegabytes, parseArguments, runPerformance, startupMilliseconds } from './perf.mjs';

const hero = 'apps/mobile/.maestro/08-hero-loop.yaml';
const fling = 'apps/mobile/.maestro/09-dashboard-fling.yaml';
const log = (ms, pkg = 'app.pawlaris') =>
  `1000.000  1  2 I ActivityTaskManager: START u0 {cmp=${pkg}/.MainActivity}\n`
  + `${(1000 + ms / 1000).toFixed(3)}  3  4 I ReactNativeJS: PAWLARIS_PERF dashboard_interactive\n`;
const gfx = (jank = 5, p99 = 34) =>
  `Total frames rendered: 200\nJanky frames: 10 (${jank}%)\n50th percentile: 8ms\n90th percentile: 12ms\n95th percentile: 16ms\n99th percentile: ${p99}ms\n`;
const activityStart = (ms, state = 'HOT') =>
  'Starting: Intent { cmp=app.pawlaris/.MainActivity }\n'
  + `Status: ok\nLaunchState: ${state}\nActivity: app.pawlaris/.MainActivity\n`
  + `ThisTime: 12\nTotalTime: ${ms}\nWaitTime: 30\nComplete\n`;

function warmSource(samples, states = []) {
  const source = fake();
  const events = [];
  let launches = 0, polls = 0;
  let pkg = 'app.pawlaris';
  source.command = async (file, args) => {
    events.push([file, args]);
    if (args.includes('logcat') && args.includes('-d')) {
      // The first poll is not ready; only the second permits Home.
      return polls++ === 0 ? '' : log(1200, pkg);
    }
    if (args.includes('start')) {
      pkg = args.at(-1).split('/')[0];
      const index = launches++ - 1;
      return index < 0 ? activityStart(2000, 'COLD')
        : activityStart(samples[index], states[index] ?? 'HOT');
    }
    return '';
  };
  source.wait = async (ms) => { events.push(['wait', ms]); };
  return { source, events };
}

function fake(overrides = {}) {
  const commands = [], waits = [], lines = [];
  return {
    commands, waits, lines,
    async command(file, args) {
      commands.push([file, args]);
      if (args.includes('logcat') && args.includes('-d')) return log(1200);
      if (args.includes('gfxinfo') && !args.includes('reset')) return gfx();
      if (args.includes('meminfo')) return 'TOTAL PSS: 307200\n';
      return '';
    },
    async wait(ms) { waits.push(ms); },
    async bundle() { return { bytes: 6 * 1024 ** 2, hermes: true }; },
    async apk() { return { bytes: 60 * 1024 ** 2, abis: ['arm64-v8a'] }; },
    output(line) { lines.push(line); },
    ...overrides,
  };
}

test('ADR-028 parses each mode and explicit device options', () => {
  for (const mode of ['startup', 'memory', 'bundle', 'apk']) {
    assert.equal(parseArguments([mode]).mode, mode);
  }
  assert.deepEqual(parseArguments(['frames', hero, '--serial', 'test-phone', '--package', 'test.app',
    '--activity', 'test.app/.MainActivity']), {
    mode: 'frames', flow: hero, serial: 'test-phone', package: 'test.app',
    activity: 'test.app/.MainActivity', apk: undefined, warm: false,
  });
  assert.equal(parseArguments(['apk', '--apk', 'release.apk']).apk, 'release.apk');
});

test('ADR-028 rejects missing, unknown, duplicate and unrelated arguments', () => {
  for (const args of [[], ['unknown'], ['frames'], ['bundle', 'extra'], ['startup', '--serial'],
    ['startup', '--unknown', 'x'], ['memory', '--serial', 'a', '--serial', 'b'],
    ['bundle', '--apk', 'a.apk'], ['frames', 'other.yaml']]) {
    assert.throws(() => parseArguments(args), /usage|argument|flow|option/i);
  }
});

test('Q-63 --warm is a startup-only boolean flag alongside device options', () => {
  const options = parseArguments(['startup', '--serial', 'test-phone', '--warm',
    '--package', 'test.app', '--activity', 'test.app/.MainActivity']);
  assert.equal(options.warm, true);
  assert.equal(options.serial, 'test-phone');
  assert.equal(options.package, 'test.app');
  assert.equal(options.activity, 'test.app/.MainActivity');
  assert.equal(parseArguments(['startup']).warm, false);
});

test('Q-63 rejects --warm outside startup, duplicated flags and flag values', () => {
  for (const args of [['memory', '--warm'], ['bundle', '--warm'], ['apk', '--warm'],
    ['frames', hero, '--warm'], ['startup', '--warm', '--warm'], ['startup', '--warm', 'true']]) {
    assert.throws(() => parseArguments(args), /usage|argument|option/i);
  }
});

test('Q-63 am start -W parser reads LaunchState and TotalTime from real-shaped output', () => {
  for (const state of ['HOT', 'WARM', 'COLD']) {
    assert.deepEqual(activityStartMetrics(activityStart(499, state)), { launchState: state, totalTime: 499 });
  }
  assert.deepEqual(activityStartMetrics(activityStart(0).replaceAll('\n', '\r\n')),
    { launchState: 'HOT', totalTime: 0 });
});

test('Q-63 am start -W parser rejects missing or malformed measurement fields', () => {
  for (const dump of ['', activityStart(10).replace('LaunchState: HOT\n', ''),
    activityStart(10).replace('TotalTime: 10\n', ''), activityStart(10, 'UNKNOWN'),
    activityStart('NaN'), activityStart(-1), activityStart('1.5'), activityStart('10ms')]) {
    assert.throws(() => activityStartMetrics(dump), /LaunchState|TotalTime/);
  }
});

test('ADR-028 startup uses epoch START for the selected package before its marker', () => {
  assert.equal(startupMilliseconds(log(1234), 'app.pawlaris'), 1234);
  assert.equal(startupMilliseconds(log(500, 'other.app') + log(1200), 'app.pawlaris'), 1200);
  for (const text of ['', log(10, 'other.app'), log(-100), log(2).split('\n')[0]]) {
    assert.throws(() => startupMilliseconds(text, 'app.pawlaris'), /startup|marker|START/i);
  }
});

test('ADR-028 frame and memory parsers require real populated counters', () => {
  assert.deepEqual(frameMetrics(gfx()), { jank: 5, p99: 34 });
  assert.equal(memoryMegabytes('TOTAL PSS: 307200 TOTAL RSS: 400000'), 300);
  assert.equal(memoryMegabytes('  TOTAL 307200 1234 5000 6000 0 0 0 0'), 300);
  for (const text of ['', gfx().replace('200', '0'), gfx().replace('99th percentile: 34ms', '')]) {
    assert.throws(() => frameMetrics(text), /frame|percentile/i);
  }
  for (const text of ['', 'TOTAL PSS: 0', 'TOTAL PSS: NaN']) {
    assert.throws(() => memoryMegabytes(text), /PSS/i);
  }
});

test('ADR-028 cold startup runs five force-stopped launches and compares the median strictly', async () => {
  let index = 0;
  const source = fake();
  const command = source.command;
  source.command = async (file, args) => args.includes('-d')
    ? log([1499, 4000, 10, 1600, 1400][index++]) : command(file, args);
  assert.equal(await runPerformance(['startup', '--serial', 'test-phone'], source), 0);
  assert.equal(index, 5);
  assert.equal(source.commands.filter(([, args]) => args.includes('force-stop')).length, 5);
  assert.ok(source.commands.every(([file, args]) => file !== 'adb' || args.slice(0, 2).join(' ') === '-s test-phone'));
  assert.ok(source.lines.some((line) => /PASS.*1499.*1500/.test(line)));
  assert.ok(!source.lines.join('\n').includes('test-phone'));
  const boundary = fake({ command: async () => log(1500) });
  assert.equal(await runPerformance(['startup'], boundary), 1);
  assert.match(boundary.lines.at(-1), /FAIL/);
});

test('Q-63 warm startup awaits one dashboard marker then five Home/wait/start cycles', async () => {
  const { source, events } = warmSource([499, 1000, 10, 600, 400], ['HOT', 'WARM']);
  assert.equal(await runPerformance(['startup', '--warm', '--serial', 'test-phone',
    '--package', 'test.app', '--activity', 'test.app/.MainActivity'], source), 0);
  const adb = (...args) => ['adb', ['-s', 'test-phone', ...args]];
  assert.deepEqual(events, [
    adb('shell', 'am', 'force-stop', 'test.app'),
    adb('logcat', '-c'),
    adb('shell', 'am', 'start', '-W', '-n', 'test.app/.MainActivity'),
    adb('logcat', '-d', '-v', 'epoch'), ['wait', 100],
    adb('logcat', '-d', '-v', 'epoch'),
    ...Array.from({ length: 5 }, () => [
      adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'), ['wait', 2000],
      adb('shell', 'am', 'start', '-W', '-n', 'test.app/.MainActivity'),
    ]).flat(),
  ]);
  assert.equal(source.lines.filter((line) => /^warm run \d+:/.test(line)).length, 5);
  assert.equal(source.lines.at(-1), 'PASS warm startup median of 5: 499 ms; budget < 500 ms');
  assert.ok(!source.lines.join('\n').includes('test-phone'));
});

test('Q-63 warm startup median boundary is strict: 500 fails and 499 passes', async () => {
  for (const [ms, exitCode, status] of [[500, 1, 'FAIL'], [499, 0, 'PASS']]) {
    const { source } = warmSource([ms, ms, ms, ms, ms]);
    assert.equal(await runPerformance(['startup', '--warm'], source), exitCode);
    assert.equal(source.lines.at(-1), `${status} warm startup median of 5: ${ms} ms; budget < 500 ms`);
  }
});

test('Q-63 any COLD return invalidates warm startup even below the budget', async () => {
  for (let coldIndex = 0; coldIndex < 5; coldIndex += 1) {
    const states = Array.from({ length: 5 }, (_, index) => index === coldIndex ? 'COLD' : 'HOT');
    const { source } = warmSource([1, 1, 1, 1, 1], states);
    await assert.rejects(() => runPerformance(['startup', '--warm'], source), /COLD/);
    assert.ok(!source.lines.some((line) => line.startsWith('PASS')));
  }
});

test('Q-63 warm startup fails without the initial dashboard marker or return fields', async () => {
  const missingMarker = fake({ command: async () => '' });
  await assert.rejects(() => runPerformance(['startup', '--warm'], missingMarker), /marker/);
  assert.ok(!missingMarker.commands.some(([, args]) => args.includes('KEYCODE_HOME')));
  assert.ok(!missingMarker.lines.some((line) => line.startsWith('PASS')));
  const { source } = warmSource([10, 10, 10, 10, 10]);
  const command = source.command;
  let launches = 0;
  source.command = async (file, args) => args.includes('start') && launches++ > 0
    ? 'Status: ok\nLaunchState: HOT\nComplete\n' : command(file, args);
  await assert.rejects(() => runPerformance(['startup', '--warm'], source), /TotalTime/);
  assert.ok(!source.lines.some((line) => line.startsWith('PASS')));
});

test('ADR-028 frames resets counters before Maestro and enforces both hero budgets', async () => {
  const source = fake();
  assert.equal(await runPerformance(['frames', hero, '--serial', 'test-phone'], source), 0);
  assert.deepEqual(source.commands.map(([file]) => file), ['adb', 'maestro', 'adb']);
  assert.ok(source.commands[0][1].includes('reset'));
  assert.deepEqual(source.commands[1][1], ['--device', 'test-phone', 'test', hero,
    '--test-output-dir', 'docs/evidence/media/P7-4', '--debug-output', 'docs/evidence/media/P7-4']);
  assert.match(source.lines.at(-1), /PASS.*5.*34/);
  for (const [jank, p99] of [[5.01, 34], [5, 35]]) {
    const failed = fake({ command: async () => gfx(jank, p99) });
    assert.equal(await runPerformance(['frames', hero], failed), 1);
    assert.match(failed.lines.at(-1), /FAIL/);
  }
  assert.equal(await runPerformance(['frames', fling], fake({ command: async () => gfx(5, 99) })), 0);
});

test('ADR-028 memory waits thirty seconds on the dashboard and compares total PSS', async () => {
  const source = fake();
  assert.equal(await runPerformance(['memory'], source), 0);
  assert.ok(source.commands[0][1].includes('start'));
  assert.deepEqual(source.waits, [30_000]);
  assert.match(source.lines.at(-1), /PASS.*300.*300/);
  const failed = fake({ command: async () => 'TOTAL PSS: 307201' });
  assert.equal(await runPerformance(['memory'], failed), 1);
});

test('ADR-028 artifact sizes include the budget boundary and reject larger artifacts', async () => {
  for (const mode of ['bundle', 'apk']) {
    const source = fake();
    assert.equal(await runPerformance([mode], source), 0);
    assert.match(source.lines.at(-1), /PASS/);
    const failed = fake({
      [mode]: async () => ({ bytes: (mode === 'bundle' ? 6 : 60) * 1024 ** 2 + 1,
        hermes: true, abis: ['arm64-v8a'] }),
    });
    assert.equal(await runPerformance([mode], failed), 1);
    assert.match(failed.lines.at(-1), /FAIL/);
  }
});

test('ADR-028 missing measurements, non-Hermes exports and universal APKs cannot pass', async () => {
  for (const [args, source] of [
    [['startup'], fake({ command: async () => '' })],
    [['frames', hero], fake({ command: async () => '' })],
    [['memory'], fake({ command: async () => '' })],
    [['bundle'], fake({ bundle: async () => ({ bytes: 1, hermes: false }) })],
    [['apk'], fake({ apk: async () => ({ bytes: 1, abis: ['arm64-v8a', 'x86_64'] }) })],
    [['apk'], fake({ apk: async () => ({ bytes: 0, abis: [] }) })],
  ]) {
    await assert.rejects(() => runPerformance(args, source));
    assert.ok(!source.lines.some((line) => line.includes('PASS')));
  }
});
