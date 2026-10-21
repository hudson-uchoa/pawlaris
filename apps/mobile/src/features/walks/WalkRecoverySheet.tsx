import { useRef, useState, type ReactElement } from 'react';
import { formatDistance, formatTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import type { RecoverableWalk } from '../../walks/recover';

export interface WalkRecoverySheetProps {
  recovery: RecoverableWalk | null;
  timezone: string;
  active: boolean;
  onContinue(): Promise<void>;
  onFinish(): Promise<void>;
}

export function WalkRecoverySheet({ recovery, timezone, active,
  onContinue, onFinish }: WalkRecoverySheetProps): ReactElement | null {
  const [dismissed, setDismissed] = useState<RecoverableWalk | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const requesting = useRef(false);
  const message = recovery === null ? strings.walks.ongoingNotificationTitle : strings.walks.recoveryMessage(
    formatTime(recovery.walk.startedAt, timezone), formatDistance(recovery.distanceM),
  );
  const run = (action: () => Promise<void>): void => {
    if (!active || requesting.current) return;
    requesting.current = true; setBusy(true); setFailed(false);
    void action().then(() => { setDismissed(recovery); })
      .catch(() => { setFailed(true); })
      .finally(() => { requesting.current = false; setBusy(false); });
  };
  return <Sheet visible={recovery !== null && dismissed !== recovery} active={active} accessibilityLabel={message}
    dismissLabel={strings.dismiss} onDismiss={() => { setDismissed(recovery); }} testID="walk-recovery">
    <Text>{message}</Text>
    {failed && <Text accessibilityRole="alert">{strings.diagnostics.operationFailed}</Text>}
    <Button label={strings.walks.resume} accessibilityLabel={strings.walks.resume}
      active={active} disabled={busy || !active} onPress={() => { run(onContinue); }} />
    <Button label={strings.walks.recoveryFinish} accessibilityLabel={strings.walks.recoveryFinish}
      active={active} disabled={busy || !active} onPress={() => { run(onFinish); }} />
  </Sheet>;
}
