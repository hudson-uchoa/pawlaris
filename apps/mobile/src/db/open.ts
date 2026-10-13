import type { SqlDriver } from './driver';

export function openDatabase(_driver: SqlDriver): void {
  throw new Error('not implemented: openDatabase');
}
