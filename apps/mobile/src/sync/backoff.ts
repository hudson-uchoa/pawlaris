import type { Random } from '../platform/random';

export function backoff(attempts: number, retryAfter: number | null, random: Random): number {
  return retryAfter ?? Math.min(60_000, 1_000 * 2 ** attempts) * (0.5 + 0.5 * random.next());
}
