import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Dimensions, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { strings } from '../../i18n/strings';
import { PoweredBy } from '../../ui/cosmos/PoweredBy';
import { Starfield } from '../../ui/cosmos/Starfield';
import { Button } from '../../ui/primitives/Button';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { PawStarMark } from './PawStarMark';
import { authLayout } from './tokens';
import type { AuthScreenProps } from './types';

export type LoginScreenProps = AuthScreenProps & { onRedeem(): void };

export function LoginScreen({ services, active, onLayout, onRedeem }: LoginScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const { width } = useWindowDimensions();
  // Android may resize the window for the keyboard. The footer stays at
  // the physical screen's foot, so the keyboard covers it instead.
  const screenHeight = Dimensions.get('screen').height;
  const connection = useSyncExternalStore(services.connection.subscribe, services.connection.getState);
  const previousUser = services.sessionUser();
  const reserve = connection.server === 'reserve' && connection.status === 'signed_out' && previousUser !== null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [discardCount, setDiscardCount] = useState<number | null>(null);
  const discardDecision = useRef<((confirmed: boolean) => void) | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      discardDecision.current?.(false);
      discardDecision.current = null;
    };
  }, []);

  const confirmDiscard = useCallback((count: number): Promise<boolean> => {
    if (!alive.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      discardDecision.current = resolve;
      setDiscardCount(count);
    });
  }, []);
  const decideDiscard = useCallback((confirmed: boolean) => {
    const resolve = discardDecision.current;
    discardDecision.current = null;
    setDiscardCount(null);
    resolve?.(confirmed);
  }, []);

  async function submit(): Promise<void> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await services.session.login({ email: reserve ? previousUser.email : email, password });
      if (!alive.current) return;
      if ('networkError' in result) {
        setError(strings.auth.networkError);
      } else if (result.ok) {
        await services.lifecycle.onLogin(result.body, { confirmDiscard });
      } else if (result.status === 401) {
        setError(strings.auth.invalidCredentials);
      } else if (result.status === 429) {
        const header = Object.entries(result.headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
        const seconds = Number(header);
        const minutes = header !== undefined && header.trim() !== '' && Number.isFinite(seconds) && seconds >= 0
          ? Math.ceil(seconds / 60) : 1;
        setError(strings.auth.rateLimited(minutes));
      }
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }

  return <View onLayout={onLayout} style={{ flex: 1, overflow: 'hidden', backgroundColor: color.bg }}>
    <View style={StyleSheet.absoluteFill}>
      <Starfield active={active} seed={authLayout.skySeed} width={width} height={screenHeight} density="full" />
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1,
      justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg + (insets?.top ?? 0),
      paddingBottom: authLayout.signatureHeight + 2 * authLayout.signatureBottomGap + (insets?.bottom ?? 0) }}>
      <View style={{ width: '100%', maxWidth: authLayout.formMaxWidth, gap: spacing.lg }}>
        <View style={{ alignItems: 'center' }}>
          <PawStarMark />
          <Text variant="display" accessibilityRole="header">{strings.appName}</Text>
        </View>
        {reserve ? <Text testID="login-reserve-note">{strings.auth.reserveNote}</Text>
          : previousUser !== null && connection.outboxCount > 0
            ? <Text>{strings.auth.pendingChanges(connection.outboxCount)}</Text> : null}
        <View style={{ gap: spacing.md }}>
          <TextField testID="login-email" label={strings.auth.loginEmail} accessibilityLabel={strings.auth.loginEmail}
            value={reserve ? previousUser.email : email} onChangeText={setEmail} disabled={reserve}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
          <TextField testID="login-password" label={strings.auth.password} accessibilityLabel={strings.auth.password}
            value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
            autoCorrect={false} autoComplete="current-password" />
          <Button testID="login-submit" label={strings.auth.login} accessibilityLabel={strings.auth.login}
            onPress={() => { void submit(); }} loading={pending} active={active} />
          {error !== null && <Text color="danger" accessibilityRole="alert">{error}</Text>}
          <PressableScale testID="login-to-redeem" accessibilityRole="link" accessibilityLabel={strings.auth.toRedeem}
            onPress={onRedeem} disabled={pending} active={active} style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="label" color="accent">{strings.auth.toRedeem}</Text>
          </PressableScale>
        </View>
      </View>
    </ScrollView>
    <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, height: authLayout.signatureHeight,
      top: screenHeight - (insets?.bottom ?? 0) - authLayout.signatureBottomGap - authLayout.signatureHeight,
      justifyContent: 'center' }}>
      <PoweredBy active={active} testID="powered-by" />
    </View>
    <Sheet visible={discardCount !== null} active={active} accessibilityLabel={strings.auth.discardTitle}
      dismissLabel={strings.dismiss} onDismiss={() => { decideDiscard(false); }}>
      <Text variant="heading">{strings.auth.discardTitle}</Text>
      <Text>{strings.auth.discardBody(discardCount ?? 0)}</Text>
      <Button testID="login-discard-confirm" label={strings.auth.discardConfirm} accessibilityLabel={strings.auth.discardConfirm}
        onPress={() => { decideDiscard(true); }} active={active} />
    </Sheet>
  </View>;
}
