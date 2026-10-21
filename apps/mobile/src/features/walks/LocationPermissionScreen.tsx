import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import type { LocationPermissions, LocationPermissionStep, LocationState, TrackingMode } from '../../walks/permissions';
import { PermissionGate } from './PermissionGate';

export interface LocationPermissionScreenProps {
  permissions: LocationPermissions;
  active: boolean;
  onComplete(mode: TrackingMode): void;
}

export function LocationPermissionScreen({ permissions, active, onComplete }: LocationPermissionScreenProps): ReactElement {
  const { color } = useTheme();
  const [step, setStep] = useState<LocationPermissionStep | null>(null);
  const [location, setLocation] = useState<LocationState>('denied');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const requesting = useRef(false);
  const completed = useRef(false);
  const complete = useRef(onComplete);
  useEffect(() => { complete.current = onComplete; }, [onComplete]);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const update = async (): Promise<void> => {
      const state = await permissions.readLocationState();
      const steps = await permissions.readLadder();
      if (!mounted || completed.current) return;
      setLocation(state);
      setStep(steps[0] ?? null);
      if (steps.length === 0) {
        completed.current = true; setFinished(true); complete.current('service');
      }
    };
    refresh.current = update;
    const unsubscribe = permissions.subscribe(() => {
      void update().catch(() => { if (mounted) setFailed(true); });
    });
    void permissions.start().then(update).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; unsubscribe(); };
  }, [active, permissions]);

  const run = (action: () => Promise<unknown>): void => {
    if (!active || requesting.current) return;
    requesting.current = true;
    setBusy(true); setFailed(false);
    void action().then(() => refresh.current()).catch(() => { setFailed(true); })
      .finally(() => { requesting.current = false; setBusy(false); });
  };
  const helpKey = permissions.manufacturer?.toLowerCase();
  const help = strings.location.batteryHelp[helpKey === 'xiaomi' || helpKey === 'samsung' || helpKey === 'motorola'
    ? helpKey : 'other'];
  return <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
      {failed && <Text accessibilityRole="alert">{strings.diagnostics.operationFailed}</Text>}
      {step === null && !finished && <Skeleton width={spacing.xxl * 5} height={spacing.xxl} active={active} />}
      {step === 'location' && <>
        <Text variant="title">{strings.diagnostics.location}</Text>
        <PermissionGate state={location} active={active && !busy}
          onRequest={() => { run(() => permissions.requestLocation()); }}
          onOpenSettings={() => { run(() => permissions.openLocationSettings()); }}>{null}</PermissionGate>
      </>}
      {step === 'notifications' && <>
        <Text variant="title">{strings.diagnostics.notifications}</Text>
        <Text>{strings.location.notificationRationale}</Text>
        <Button label={strings.notifications.activate} accessibilityLabel={strings.notifications.activate}
          active={active} disabled={busy || !active} onPress={() => { run(() => permissions.requestNotifications()); }} />
      </>}
      {step === 'battery' && <>
        <Text variant="title">{strings.location.batteryTitle}</Text>
        <Text>{strings.location.batteryRationale}</Text>
        {help.map((line) => <Text key={line}>{line}</Text>)}
        <Button label={strings.location.settings} accessibilityLabel={strings.location.settings}
          active={active} disabled={busy || !active} onPress={() => { run(() => permissions.openBatterySettings()); }} />
      </>}
      {step === 'backgroundLocation' && <>
        <Text variant="title">{strings.location.backgroundTitle}</Text>
        <Text>{strings.location.backgroundRationale}</Text>
        <Button label={strings.location.settings} accessibilityLabel={strings.location.settings}
          active={active} disabled={busy || !active} onPress={() => { run(() => permissions.openBackgroundSettings()); }} />
        <Button label={strings.notifications.later} accessibilityLabel={strings.notifications.later}
          active={active} disabled={busy || !active} onPress={() => {
            if (!active || requesting.current || completed.current) return;
            completed.current = true; setFinished(true); complete.current('foreground');
          }} />
      </>}
    </ScrollView>
  </SafeAreaView>;
}
