import assert from 'node:assert/strict';
import test from 'node:test';
import { frameMetrics, memoryMegabytes, parseArguments, runPerformance, startupMilliseconds } from './perf.mjs';

const hero = 'apps/mobile/.maestro/08-hero-loop.yaml';
const fling = 'apps/mobile/.maestro/09-dashboard-fling.yaml';
const log = (ms, pkg = 'app.pawlaris') =>
  `1000.000  1  2 I ActivityTaskManager: START u0 {cmp=${pkg}/.MainActivity}\n`
  + `${(1000 + ms / 1000).toFixed(3)}  3  4 I ReactNativeJS: PAWLARIS_PERF dashboard_interactive\n`;
const gfx = (jank = 5, p99 = 34) =>
  `Total frames rendered: 200\nJanky frames: 10 (${jank}%)\n50th percentile: 8ms\n90th percentile: 12ms\n95th percentile: 16ms\n99th percentile: ${p99}ms\n`;

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
    activity: 'test.app/.MainActivity', apk: undefined,
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
