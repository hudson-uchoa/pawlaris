import type { Random } from '../platform/random';

export function backoff(_attempts: number, _retryAfter: number | null, _random: Random): number {
  throw new Error('not implemented');
}
