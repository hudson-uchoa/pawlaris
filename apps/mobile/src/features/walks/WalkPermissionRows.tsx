import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import type { LocationPermissions, WalkPermissionStates } from '../../walks/permissions';

export interface WalkPermissionRowsProps {
  permissions: LocationPermissions;
  active: boolean;
  onLocation(): void;
}

export function WalkPermissionRows({ permissions, active, onLocation }: WalkPermissionRowsProps): ReactElement {
  const [states, setStates] = useState<WalkPermissionStates | null>(null);
  const [failed, setFailed] = useState(false);
  const requesting = useRef(false);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const refresh = (): void => {
      void permissions.readRows().then((next) => { if (mounted) setStates(next); })
        .catch(() => { if (mounted) setFailed(true); });
    };
    const unsubscribe = permissions.subscribe(refresh);
    void permissions.start().then(refresh).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; unsubscribe(); };
  }, [active, permissions]);
  const run = (action: () => Promise<unknown>): void => {
    if (!active || requesting.current) return;
    requesting.current = true; setFailed(false);
    void action().then(() => permissions.readRows()).then(setStates)
      .catch(() => { setFailed(true); }).finally(() => { requesting.current = false; });
  };
  const status = (state: 'granted' | 'approximate' | 'denied' | 'blocked'): string => {
    if (state === 'approximate' || state === 'blocked') return strings.location[state];
    return strings.diagnostics[state];
  };
  return <>
    {failed && <Text accessibilityRole="alert">{strings.diagnostics.operationFailed}</Text>}
    {(['location', 'backgroundLocation', 'battery', 'camera'] as const).map((permission) => (
      <View key={permission} testID={`permission-${permission}`} style={{ gap: spacing.xs }}>
        <Button label={strings.diagnostics[permission]} accessibilityLabel={strings.diagnostics[permission]}
          active={active} disabled={!active} onPress={() => {
            if (permission === 'location') {
              if (states?.location === 'denied') onLocation();
              else run(() => permissions.openLocationSettings());
            } else if (permission === 'backgroundLocation') run(() => permissions.openBackgroundSettings());
            else if (permission === 'battery') run(() => permissions.openBatterySettings());
            else run(() => states?.camera === 'denied' ? permissions.requestCamera() : permissions.openCameraSettings());
          }} />
        {states === null ? <Skeleton width={spacing.xxl * 3} height={spacing.lg} active={active} />
          : <Text>{permission === 'battery'
            ? strings.location[states.batteryOptimizationEnabled ? 'enabled' : 'disabled']
            : status(states[permission])}</Text>}
      </View>
    ))}
  </>;
}
