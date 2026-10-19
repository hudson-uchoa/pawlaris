import type { Completion, Member } from '@pawlaris/shared';
import type { ReactElement } from 'react';

export interface UndoCompletionSheetProps {
  completion: Completion | null;
  member: Member | undefined;
  timezone: string;
  active: boolean;
  onConfirm(): void;
  onDismiss(): void;
}

export function UndoCompletionSheet(_props: UndoCompletionSheetProps): ReactElement | null {
  throw new Error('not implemented');
}
