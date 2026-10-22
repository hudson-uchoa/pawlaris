#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export function createProtocol(config, measurement) { throw new Error('not implemented'); }

export const MAESTRO = 'C:/Tools/maestro/bin/maestro.bat';
export function parseArguments(args) { throw new Error('not implemented'); }
export function flowCommand(serial, flow, url) { throw new Error('not implemented'); }
export function createMeasurement(name, now) { throw new Error('not implemented'); }
export async function runTwoDevice(args, source) { throw new Error('not implemented'); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runTwoDevice(process.argv.slice(2)); }
  catch (error) {
    console.error(`e2e: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
