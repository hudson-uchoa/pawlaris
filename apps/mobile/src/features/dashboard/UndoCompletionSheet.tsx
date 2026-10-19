import type { Completion, Member } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import { formatTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';

export interface UndoCompletionSheetProps {
  completion: Completion | null;
  member: Member | undefined;
  timezone: string;
  active: boolean;
  onConfirm(): void;
  onDismiss(): void;
}

export function UndoCompletionSheet({ completion, member, timezone, active,
  onConfirm, onDismiss }: UndoCompletionSheetProps): ReactElement {
  return <Sheet visible={completion !== null} active={active} accessibilityLabel={strings.dashboard.undoTitle}
    dismissLabel={strings.dismiss} onDismiss={onDismiss} testID="undo-sheet">
    {completion !== null && <Text>{strings.dashboard.undoBody(
      member?.display_name ?? strings.format.unavailable,
      formatTime(Date.parse(completion.completed_at), timezone),
    )}</Text>}
    <Button testID="undo-confirm" label={strings.dashboard.undo} accessibilityLabel={strings.dashboard.undo}
      active={active} onPress={onConfirm} />
    <Button label={strings.dashboard.cancel} accessibilityLabel={strings.dashboard.cancel}
      active={active} onPress={onDismiss} />
  </Sheet>;
}
