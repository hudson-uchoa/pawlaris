import type { OutboxEntry } from '../db/outboxRepo';
import type { ApiResult } from './client';

export type ResultClass = 'ok' | 'transient' | 'permanent' | 'auth';

export function classify(
  result: ApiResult, entry?: Pick<OutboxEntry, 'serverErrors'>,
): ResultClass {
  if ('networkError' in result) return 'transient';
  const { status } = result;
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 425 || status === 429) return 'transient';
  if (status >= 500 && status < 600) {
    return (entry?.serverErrors ?? 0) >= 7 ? 'permanent' : 'transient';
  }
  if (status === 401) return 'auth';
  if (status >= 400 && status < 500) return 'permanent';
  return 'permanent';
}
