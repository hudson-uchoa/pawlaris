#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export function parseArguments(_args) { throw new Error('not implemented'); }
export function startupMilliseconds(_log, _pkg) { throw new Error('not implemented'); }
export function frameMetrics(_dump) { throw new Error('not implemented'); }
export function memoryMegabytes(_dump) { throw new Error('not implemented'); }
export async function runPerformance(_args, _sources) { throw new Error('not implemented'); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runPerformance(process.argv.slice(2)); }
  catch (error) {
    console.error(`perf: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
