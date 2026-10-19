import type { Logger } from '../../platform/logger';
import type { LogShare } from './types';

export async function exportLogs(
  logger: Pick<Logger, 'exportText'>, share: LogShare,
): Promise<void> {
  const text = await logger.exportText();
  const redacted = text.split('\n').filter((line) => line.trim() !== '').map((line) => {
    try {
      return JSON.stringify(redact(JSON.parse(line) as unknown));
    } catch {
      // A truncated or malformed record cannot be proven safe to export.
      return JSON.stringify({ event: 'invalid_log_record_redacted' });
    }
  }).join('\n');
  await share.shareText('pawlaris-logs.txt', redacted === '' ? '' : `${redacted}\n`);
}

const credentialKey = /authorization|(?:access|refresh)[_-]?token|password/i;

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    // Free-text assignments have no reliable value boundary: withhold the field.
    if (/\b(?:(?:access|refresh)[_-]?token|(?:current|new)[_-]?password|password)\s*[:=]/i.test(value)) {
      return '[REDACTED]';
    }
    return value.replace(/\bBearer(?:\s+[^\s"',;\\]+)?/gi, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]: [string, unknown]) =>
      [key, credentialKey.test(key) ? '[REDACTED]' : redact(entry)]));
  }
  return value;
}
