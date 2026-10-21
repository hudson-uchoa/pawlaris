import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import type { LocationState } from '../../walks/permissions';

export interface PermissionGateProps {
  state: LocationState;
  active: boolean;
  children: ReactNode;
  onRequest(): void;
  onOpenSettings(): void;
}

export function PermissionGate({ state, active, children, onRequest, onOpenSettings }: PermissionGateProps): ReactElement {
  if (state === 'granted') return <>{children}</>;
  const label = state === 'denied' ? strings.location.allow : strings.location.settings;
  return <View style={{ gap: spacing.md }}>
    <Text>{state === 'approximate' ? strings.location.preciseRequired : strings.location.rationale}</Text>
    <Button label={label} accessibilityLabel={label} active={active} disabled={!active}
      onPress={state === 'denied' ? onRequest : onOpenSettings} />
  </View>;
}
