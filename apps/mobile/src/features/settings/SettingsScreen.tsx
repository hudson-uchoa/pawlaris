import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { strings } from '../../i18n/strings';
import { PoweredBy } from '../../ui/cosmos/PoweredBy';
import { Button } from '../../ui/primitives/Button';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { accountAvailability } from '../family/accountAvailability';
import type { SettingsScreenProps } from './types';

export function SettingsScreen({ services, active, onOpen }: SettingsScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const connection = useSyncExternalStore(services.connection.subscribe, services.connection.getState);
  const availability = accountAvailability('password', connection);
  const online = connection.status === 'synced' || connection.status === 'syncing';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [discardCount, setDiscardCount] = useState<number | null>(null);
  const decision = useRef<((confirmed: boolean) => void) | null>(null);
  const running = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      decision.current?.(false);
      decision.current = null;
    };
  }, []);

  function decide(confirmed: boolean): void {
    const resolve = decision.current;
    decision.current = null;
    setDiscardCount(null);
    resolve?.(confirmed);
  }

  async function logout(): Promise<void> {
    const { status } = services.connection.getState();
    if (!active || running.current || (status !== 'synced' && status !== 'syncing')) return;
    running.current = true;
    setPending(true);
    setError(false);
    try {
      await services.lifecycle.logout({
        confirmDiscard: (count) => new Promise<boolean>((resolve) => {
          if (!alive.current) { resolve(false); return; }
          decision.current = resolve;
          setDiscardCount(count);
        }),
      });
    } catch {
      if (alive.current) setError(true);
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }

  const rows = ['family', 'password', 'permissions', 'diagnostics'] as const;
  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    {rows.map((destination) => <Button key={destination} testID={`settings-${destination}`}
      label={strings.settings[destination]} accessibilityLabel={strings.settings[destination]} active={active}
      disabled={pending || (destination === 'password' && availability !== 'available')}
      onPress={() => {
        if (!active || running.current) return;
        if (destination === 'password'
          && accountAvailability('password', services.connection.getState()) !== 'available') return;
        onOpen(destination);
      }} />)}
    {availability !== 'available' && <Text testID={`${availability}-note`} color="textMuted">
      {availability === 'offline' ? strings.settings.offlineNote : strings.settings.reserveNote}
    </Text>}
    <Button testID="logout" label={strings.settings.logout} accessibilityLabel={strings.settings.logout}
      active={active} disabled={!online} loading={pending} onPress={() => { void logout(); }} />
    <View style={{ marginTop: spacing.xl - spacing.md, alignItems: 'center', gap: spacing.xs }}>
      <Text testID="settings-author" variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
        {strings.settings.author}
      </Text>
      <PoweredBy active={active} testID="powered-by" href="https://insurge.pages.dev" />
    </View>
    {error && <Text color="danger" accessibilityRole="alert">{strings.settings.operationFailed}</Text>}
    <Sheet visible={discardCount !== null} active={active} accessibilityLabel={strings.settings.logout}
      dismissLabel={strings.dismiss} onDismiss={() => { decide(false); }}>
      <Text>{strings.settings.logoutConfirmation(discardCount ?? 0)}</Text>
      <Button testID="logout-confirm" label={strings.settings.logout} accessibilityLabel={strings.settings.logout}
        active={active} onPress={() => { decide(true); }} />
    </Sheet>
  </ScrollView>;
}
