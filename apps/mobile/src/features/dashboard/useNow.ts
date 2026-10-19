import type { Clock } from '../../platform/clock';

export function useNow(_clock: Clock, _intervalMs: number): number {
  throw new Error('not implemented');
}
