import type { LogFiles } from '../platform/logger';

export function fakeLogFiles(initialActive = '', initialArchive = '') {
  let active = initialActive;
  let archive = initialArchive;
  let rotations = 0;
  return {
    get active() { return active; },
    get archive() { return archive; },
    get rotations() { return rotations; },
    async read() { return active; },
    async readArchive() { return archive; },
    async write(text: string) { active = text; },
    async rotate() { archive = active; active = ''; rotations += 1; },
  } satisfies LogFiles & { readonly active: string; readonly archive: string; readonly rotations: number };
}
