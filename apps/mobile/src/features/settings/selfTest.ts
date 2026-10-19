import type * as Shared from '@pawlaris/shared';

export type SelfTestEngine = Pick<typeof Shared,
  'occurrences' | 'localDate' | 'localTime' | 'slotInstant'>;

export interface SelfTestResult {
  passed: number;
  total: number;
  failures: string[];
}

export function runSelfTest(_engine?: SelfTestEngine): SelfTestResult {
  throw new Error('not implemented');
}
