import type { OutboxEntry } from '../db/outboxRepo';
import type { ApiResult } from './client';

export type ResultClass = 'ok' | 'transient' | 'permanent' | 'auth';

export function classify(
  _result: ApiResult, _entry?: Pick<OutboxEntry, 'serverErrors'>,
): ResultClass {
  throw new Error('classify is not implemented');
}
