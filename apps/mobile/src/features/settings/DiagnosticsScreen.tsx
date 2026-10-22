import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatDateTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { Button } from '../../ui/primitives/Button';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { exportLogs } from './exportLogs';
import type { SelfTestResult } from './selfTest';
import type { DiagnosticsScreenProps } from './types';

type Action = 'sync' | 'selftest' | 'rebuild' | 'export' | 'perf-seed';

export function DiagnosticsScreen({ services, active }: DiagnosticsScreenProps): ReactElement {
  const connection = services.engine.state;
  const { status, server, outboxCount } = useSyncExternalStore(connection.subscribe, connection.getState);
  const timezone = useReplica((state) => state.family?.timezone ?? 'America/Sao_Paulo');
  const details = services.details();
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [camera, setCamera] = useState<boolean | null>(null);
  const [health, setHealth] = useState<{ server: typeof server; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState(false);
  const pending = useRef<Action | null>(null);
  const mounted = useRef(false);
  const online = status === 'synced' || status === 'syncing';
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void services.camera.getPermission().then(
      (granted) => { if (current) setCamera(granted); },
      () => { if (current) setCamera(null); },
    );
    return () => { current = false; };
  }, [active, services.camera]);
  useEffect(() => {
    if (!active || !online) return;
    let current = true;
    void services.checkHealth().then(
      (ok) => { if (current) setHealth({ server, ok }); },
      () => { if (current) setHealth({ server, ok: false }); },
    );
    return () => { current = false; };
  }, [active, online, server, services]);

  function run(action: Action, operation: () => Promise<void>): void {
    if (pending.current !== null) return;
    pending.current = action;
    setBusy(action);
    setError(false);
    void operation().catch(() => { if (mounted.current) setError(true); }).finally(() => {
      pending.current = null;
      if (mounted.current) setBusy(null);
    });
  }
  const statusLabel = status === 'signed_out' ? strings.diagnostics.signedOut
    : strings.sync[status]
      + (status === 'syncing' && outboxCount > 0 ? ` (${outboxCount})` : '')
      + (status !== 'offline' && server === 'reserve' ? strings.sync.reserveSuffix : '');
  const rows = [
    ['connection', strings.diagnostics.connection, statusLabel],
    ['revision', strings.diagnostics.revision, String(details.revision)],
    ['outbox', strings.diagnostics.outbox, String(outboxCount)],
    ['uploads', strings.diagnostics.pendingUploads, String(details.pendingUploads)],
    ['camera', strings.diagnostics.camera, camera === null ? strings.diagnostics.unchecked
      : camera ? strings.diagnostics.granted : strings.diagnostics.denied],
    ['notifications', strings.diagnostics.notifications, strings.diagnostics.unavailable],
    ['location', strings.diagnostics.location, strings.diagnostics.unavailable],
    ['background-location', strings.diagnostics.backgroundLocation, strings.diagnostics.unavailable],
    ['normal-channel', strings.diagnostics.normalChannel, strings.diagnostics.unavailable],
    ['critical-channel', strings.diagnostics.criticalChannel, strings.diagnostics.unavailable],
    ['battery', strings.diagnostics.battery, strings.diagnostics.unavailable],
    ['health', strings.diagnostics.apiHealth, !online ? strings.sync.offline
      : health === null || health.server !== server ? strings.diagnostics.unchecked
        : health.ok ? strings.diagnostics.healthy : strings.diagnostics.unavailable],
    ['version', strings.diagnostics.version, details.version ?? strings.diagnostics.unavailable],
    ['build', strings.diagnostics.build, details.build === null ? strings.diagnostics.unavailable : String(details.build)],
  ] as const;
  const actions = [
    { action: 'sync', label: strings.diagnostics.sync, disabled: !online,
      operation: () => services.engine.kick('refresh') },
    { action: 'selftest', label: strings.settings.selfTest, disabled: false,
      operation: async () => { setSelfTest(services.selfTest()); } },
    { action: 'rebuild', label: strings.diagnostics.rebuild, disabled: !online,
      operation: () => services.rebuild() },
    { action: 'export', label: strings.settings.exportLogs, disabled: false,
      operation: () => exportLogs(services.logger, services.share) },
  ] satisfies { action: Action; label: string; disabled: boolean; operation(): Promise<void> }[];
  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    {rows.map(([id, label, value]) => <View key={id} testID={`diag-${id}`} style={{ gap: spacing.xxs }}>
      <Text variant="caption" color="textMuted">{label}</Text><Text>{value}</Text>
    </View>)}
    <Button testID="diag-dead-letters" label={`${strings.diagnostics.deadLetters} (${details.deadLetters.length})`}
      accessibilityLabel={strings.diagnostics.deadLetters} active={active}
      onPress={() => { setExpanded((value) => !value); }} />
    {expanded && details.deadLetters.map((entry) => <View key={entry.clientMutationId}
      testID={`diag-dead-letter-${entry.clientMutationId}`} style={{ gap: spacing.xxs }}>
      <Text>{entry.method} {entry.path}</Text><Text>{entry.status} · {entry.error}</Text>
      <Text variant="caption" color="textMuted">{formatDateTime(entry.failedAt, timezone)}</Text>
    </View>)}
    {!online && <Text testID="offline-note" color="textMuted">{strings.settings.offlineNote}</Text>}
    {actions.map(({ action, label, disabled, operation }) => <Button key={action} testID={`diag-${action}`}
      label={label} accessibilityLabel={label} active={active} disabled={disabled || busy !== null}
      loading={busy === action} onPress={() => { run(action, operation); }} />)}
    {process.env.EXPO_PUBLIC_PERF_SEED === '1' && services.seedPerformance !== undefined &&
      <Button testID="diag-perf-seed" label={strings.diagnostics.perfSeed}
        accessibilityLabel={strings.diagnostics.perfSeed} active={active} disabled={busy !== null}
        onPress={() => { run('perf-seed', async () => { services.seedPerformance?.(); }); }} />}
    {selfTest !== null && <View testID="diag-selftest-result" accessibilityLiveRegion="polite">
      <Text>{strings.settings.selfTestResult(selfTest.passed, selfTest.total)}</Text>
      {selfTest.failures.map((name, index) => <Text key={`${index}:${name}`} color="danger">{name}</Text>)}
    </View>}
    {error && <Text accessibilityRole="alert" color="danger">{strings.diagnostics.operationFailed}</Text>}
  </ScrollView>;
}
