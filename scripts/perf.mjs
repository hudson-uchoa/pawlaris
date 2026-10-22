#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = resolve(ROOT, 'apps/mobile');
const FLOWS = ['08-hero-loop.yaml', '09-dashboard-fling.yaml'];
const MB = 1024 ** 2;
const USAGE = 'Usage: perf.mjs startup [--warm] | frames <flow> | memory | bundle | apk [--apk <file>] '
  + '[--serial <serial>] [--package <pkg>] [--activity <pkg/activity>]';

/** @param {string[]} args */
export function parseArguments(args) {
  const [mode, ...rest] = args;
  if (!['startup', 'frames', 'memory', 'bundle', 'apk'].includes(mode)) throw new Error(USAGE);
  const positional = [], options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (arg === '--warm') {
      if (mode !== 'startup' || options.warm) throw new Error(`Invalid option. ${USAGE}`);
      options.warm = true;
      continue;
    }
    const key = arg.slice(2), value = rest[++index];
    if (!['serial', 'package', 'activity', 'apk'].includes(key) || key in options
      || !value || value.startsWith('--')) throw new Error(`Invalid option. ${USAGE}`);
    options[key] = value;
  }
  if (positional.length !== (mode === 'frames' ? 1 : 0)
    || (options.apk !== undefined && mode !== 'apk')) throw new Error(`Invalid arguments. ${USAGE}`);
  const flow = positional[0];
  if (flow !== undefined && !FLOWS.some((name) => flow.replaceAll('\\', '/') === `apps/mobile/.maestro/${name}`)) {
    throw new Error(`Unknown performance flow. ${USAGE}`);
  }
  const pkg = options.package ?? 'app.pawlaris';
  const activity = options.activity ?? `${pkg}/.MainActivity`;
  if (!/^[\w.]+$/.test(pkg) || !/^[\w./$]+$/.test(activity)
    || (options.serial !== undefined && !/^[\w.:-]+$/.test(options.serial))) {
    throw new Error('Invalid device option');
  }
  return { mode, flow, serial: options.serial, package: pkg, activity, apk: options.apk, warm: options.warm ?? false };
}

/** @param {string} log @param {string} pkg */
export function startupMilliseconds(log, pkg) {
  let start;
  for (const line of log.split(/\r?\n/)) {
    const epoch = /^\s*(\d+\.\d+)\s/.exec(line);
    if (!epoch) continue;
    const timestamp = Number(epoch[1]);
    if (/ActivityTaskManager: START\b/.test(line) && line.includes(`${pkg}/`)) start = timestamp;
    if (line.includes('PAWLARIS_PERF dashboard_interactive') && start !== undefined) {
      const elapsed = Math.round((timestamp - start) * 1000);
      if (elapsed < 0) throw new Error('Invalid startup marker timestamp');
      return elapsed;
    }
  }
  throw new Error('Missing startup START or dashboard marker');
}

/** @param {string} dump */
export function activityStartMetrics(dump) {
  const state = /^LaunchState:[ \t]*(COLD|WARM|HOT)[ \t]*\r?$/m.exec(dump);
  const time = /^TotalTime:[ \t]*(\d+)[ \t]*\r?$/m.exec(dump);
  if (!state || !time || !Number.isSafeInteger(Number(time[1]))) {
    throw new Error('Missing or invalid LaunchState or TotalTime');
  }
  return { launchState: state[1], totalTime: Number(time[1]) };
}

/** @param {string} dump */
export function frameMetrics(dump) {
  // Use the process summary, before any per-window histograms.
  const total = /Total frames rendered:\s*(\d+)/.exec(dump);
  const jank = /Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(dump);
  const p99 = /99th percentile:\s*(\d+(?:\.\d+)?)\s*ms/.exec(dump);
  if (!total || Number(total[1]) <= 0 || !jank || !p99
    || !Number.isFinite(Number(jank[1])) || Number(jank[1]) > 100) {
    throw new Error('Missing populated frame counters or percentile');
  }
  return { jank: Number(jank[1]), p99: Number(p99[1]) };
}

/** @param {string} dump */
export function memoryMegabytes(dump) {
  const match = /TOTAL PSS:\s*(\d+)/.exec(dump) ?? /^\s*TOTAL\s+(\d+)\s/m.exec(dump);
  if (!match || Number(match[1]) <= 0) throw new Error('Missing positive TOTAL PSS');
  return Number(match[1]) / 1024;
}

/**
 * All measurement sources are injectable. Fake sources are used only by tests;
 * the CLI always measures the export, APK or selected adb device.
 * @param {string[]} args
 * @param {ReturnType<typeof productionSources>} sources
 */
export async function runPerformance(args, sources = productionSources()) {
  const options = parseArguments(args);
  const adb = (...args) => sources.command('adb', [...(options.serial ? ['-s', options.serial] : []), ...args]);
  const report = (metric, value, budget, pass) => {
    sources.output(`${pass ? 'PASS' : 'FAIL'} ${metric}: ${value}; budget ${budget}`);
    return pass ? 0 : 1;
  };
  if (options.mode === 'startup') {
    const samples = [];
    // A warm measurement starts with one fresh launch so its ready marker
    // cannot be left over from an earlier session.
    for (let run = 0; run < (options.warm ? 1 : 5); run += 1) {
      await adb('shell', 'am', 'force-stop', options.package);
      await adb('logcat', '-c');
      await adb('shell', 'am', 'start', '-W', '-n', options.activity);
      let elapsed;
      for (let poll = 0; poll < 150; poll += 1) {
        const log = await adb('logcat', '-d', '-v', 'epoch');
        if (log.includes('PAWLARIS_PERF dashboard_interactive')) {
          elapsed = startupMilliseconds(log, options.package);
          break;
        }
        await sources.wait(100);
      }
      if (elapsed === undefined) throw new Error('Timed out waiting for startup dashboard marker');
      if (!options.warm) {
        samples.push(elapsed);
        sources.output(`cold run ${run + 1}: ${elapsed} ms`);
      }
    }
    if (options.warm) {
      for (let run = 0; run < 5; run += 1) {
        await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
        await sources.wait(2000);
        const { launchState, totalTime } = activityStartMetrics(
          await adb('shell', 'am', 'start', '-W', '-n', options.activity));
        if (launchState === 'COLD') throw new Error(`Warm startup run ${run + 1} has LaunchState COLD`);
        samples.push(totalTime);
        sources.output(`warm run ${run + 1}: ${totalTime} ms (${launchState})`);
      }
    }
    const median = [...samples].sort((a, b) => a - b)[2];
    const budget = options.warm ? 500 : 1500;
    return report(`${options.warm ? 'warm' : 'cold'} startup median of 5`, `${median} ms`,
      `< ${budget} ms`, median < budget);
  }
  if (options.mode === 'frames') {
    await adb('shell', 'dumpsys', 'gfxinfo', options.package, 'reset');
    await sources.command('maestro', [...(options.serial ? ['--device', options.serial] : []), 'test', options.flow,
      '--test-output-dir', 'docs/evidence/media/P7-4', '--debug-output', 'docs/evidence/media/P7-4']);
    const { jank, p99 } = frameMetrics(await adb('shell', 'dumpsys', 'gfxinfo', options.package));
    const hero = options.flow.replaceAll('\\', '/').endsWith(FLOWS[0]);
    return report(hero ? 'hero frames' : 'dashboard frames', `${jank}% janky, p99 ${p99} ms`,
      hero ? '<= 5% janky, p99 <= 34 ms' : '<= 5% janky', jank <= 5 && (!hero || p99 <= 34));
  }
  if (options.mode === 'memory') {
    // Re-select Hoje even if the previous measurement left a profile open.
    await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW',
      '-d', 'pawlaris:///', '-n', options.activity);
    await sources.wait(30_000);
    const memory = memoryMegabytes(await adb('shell', 'dumpsys', 'meminfo', options.package));
    return report('dashboard total PSS after 30 s', `${memory.toFixed(3)} MB`, '<= 300 MB', memory <= 300);
  }
  if (options.mode === 'bundle') {
    const { bytes, hermes } = await sources.bundle();
    if (!hermes || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Missing Hermes bytecode bundle');
    return report('Android Hermes bundle', `${bytes} bytes (${(bytes / MB).toFixed(3)} MB)`, '<= 6 MB', bytes <= 6 * MB);
  }
  const { bytes, abis } = await sources.apk(options.apk);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || abis.length !== 1 || abis[0] !== 'arm64-v8a') {
    throw new Error('Release APK must contain only arm64-v8a native libraries');
  }
  return report('arm64-v8a release APK', `${bytes} bytes (${(bytes / MB).toFixed(3)} MB)`, '<= 60 MB', bytes <= 60 * MB);
}

/** Read native ABI names from the ZIP central directory, not incidental bytes. */
export function apkAbis(buffer) {
  let end = buffer.length - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < minimum) throw new Error('Invalid APK ZIP directory');
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  const abis = new Set();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid APK entry');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const match = /^lib\/([^/]+)\/[^/]+\.so$/.exec(name);
    if (match) abis.add(match[1]);
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return [...abis].sort();
}

function productionSources() {
  const execute = promisify(execFile);
  const command = async (file, args, cwd = ROOT) => {
    // cmd is needed only for Maestro's Windows batch launcher. Validate each
    // argument before constructing its command line; never interpolate a shell
    // command from an APK path or arbitrary caller input.
    const batch = file === 'maestro' && process.platform === 'win32';
    if (batch) {
      const launcher = 'C:/Tools/maestro/bin/maestro.bat';
      if (!existsSync(launcher)) throw new Error('Maestro launcher is missing');
      if (args.some((arg) => !/^[\w./\\:-]+$/.test(arg))) throw new Error('Invalid Maestro argument');
      args = ['/d', '/s', '/c', `""${launcher}" ${args.map((arg) => `"${arg}"`).join(' ')}"`];
      file = 'cmd.exe';
    }
    try {
      const result = await execute(file, args, { cwd, windowsHide: true, windowsVerbatimArguments: batch, timeout: 180_000,
        maxBuffer: 16 * 1024 ** 2, env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' } });
      return result.stdout;
    } catch {
      throw new Error(`${file === process.execPath ? 'Expo export' : file} failed; check the tool and selected device`);
    }
  };
  return {
    command, wait: setTimeout, output: (line) => console.log(line),
    async bundle() {
      const require = createRequire(resolve(MOBILE, 'package.json'));
      const expo = require.resolve('expo/bin/cli');
      const output = resolve(ROOT, '.cache/perf-export');
      // Equivalent to npx expo export --platform android, using the pinned CLI.
      await command(process.execPath, [expo, 'export', '--platform', 'android', '--output-dir', output], MOBILE);
      const metadata = JSON.parse(readFileSync(resolve(output, 'metadata.json'), 'utf8'));
      const bundle = metadata.fileMetadata?.android?.bundle;
      if (typeof bundle !== 'string') throw new Error('Export has no Android bundle');
      const path = resolve(output, bundle);
      if (!path.startsWith(output + sep)) {
        throw new Error('Export bundle escapes its directory');
      }
      const bytecode = readFileSync(path);
      return { bytes: bytecode.length, hermes: bytecode.subarray(0, 8).equals(Buffer.from('c61fbc03c103191f', 'hex')) };
    },
    async apk(path = 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk') {
      const file = resolve(ROOT, path);
      return { bytes: statSync(file).size, abis: apkAbis(readFileSync(file)) };
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runPerformance(process.argv.slice(2)); }
  catch (error) {
    console.error(`perf: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
