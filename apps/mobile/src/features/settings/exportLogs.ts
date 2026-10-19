import type { Logger } from '../../platform/logger';
import type { LogShare } from './types';

export async function exportLogs(
  _logger: Pick<Logger, 'exportText'>, _share: LogShare,
): Promise<void> {
  throw new Error('not implemented');
}
