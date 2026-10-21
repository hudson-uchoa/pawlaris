import type { ReactElement } from 'react';
import type { RecoverableWalk } from '../../walks/recover';

export interface WalkRecoverySheetProps {
  recovery: RecoverableWalk | null;
  timezone: string;
  active: boolean;
  onContinue(): Promise<void>;
  onFinish(): Promise<void>;
}

export function WalkRecoverySheet(_props: WalkRecoverySheetProps): ReactElement | null {
  throw new Error('not implemented');
}
