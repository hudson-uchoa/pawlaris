import { validatePassword } from '@pawlaris/shared';
import { useCallback, useContext, useEffect, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, View, useWindowDimensions, type TextInput } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatValidationError } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Starfield } from '../../ui/cosmos/Starfield';
import { Button } from '../../ui/primitives/Button';
import { KeyboardAwareForm } from '../../ui/primitives/KeyboardAwareForm';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { authLayout } from './tokens';
import type { AuthScreenProps } from './types';

type FieldErrors = { code?: string; name?: string; email?: string; password?: string };

export function RedeemScreen({ services, active, onLayout }: AuthScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const { width, height } = useWindowDimensions();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const nameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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
    const errors: FieldErrors = {};
    if (code.length !== 10) errors.code = strings.validation.fallback;
    const nameLength = [...name].length;
    if (nameLength === 0 || nameLength > 40) {
      errors.name = formatValidationError({ field: 'name', code: nameLength === 0 ? 'required' : 'out_of_range' });
    }
    // Match the accepted redeem schema's email bounds and reserved domain.
    const emailLength = [...email].length;
    if (emailLength < 3 || emailLength > 254 || /\s/.test(email) || !email.slice(1, -1).includes('@')
      || email.startsWith('@') || email.endsWith('@') || email.split('@').at(-1)?.toLowerCase() === 'pawlaris.invalid') {
      errors.email = strings.validation.fallback;
    }
    const passwordError = validatePassword(password)[0];
    if (passwordError !== undefined) errors.password = formatValidationError(passwordError);
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    running.current = true;
    setPending(true);
    try {
      const result = await services.session.redeem({ code, display_name: name, email, password });
      if (!alive.current) return;
      if ('networkError' in result) {
        setError(strings.auth.networkError);
      } else if (result.ok) {
        await services.lifecycle.onLogin(result.body, { confirmDiscard });
      } else if (result.status === 410) {
        setError(strings.auth.invalidInvite);
      } else if (result.status === 409) {
        setError(strings.auth.emailInUse);
      }
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }

  return <View onLayout={onLayout} style={{ flex: 1, backgroundColor: color.bg }}>
    <View style={StyleSheet.absoluteFill}>
      <Starfield active={active} seed={authLayout.skySeed} width={width} height={height} density="full" />
    </View>
    <KeyboardAwareForm contentContainerStyle={{ flexGrow: 1,
      justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg + (insets?.top ?? 0), paddingBottom: spacing.lg + (insets?.bottom ?? 0) }}>
      <View style={{ width: '100%', maxWidth: authLayout.formMaxWidth, gap: spacing.md }}>
        <Text variant="title" accessibilityRole="header">{strings.auth.redeem}</Text>
        <TextField testID="redeem-code" label={strings.auth.redeemCode} accessibilityLabel={strings.auth.redeemCode}
          returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { nameInput.current?.focus(); }}
          value={code} onChangeText={(value) => { setCode(value.toUpperCase().slice(0, 10)); }}
          maxLength={10} autoCapitalize="characters" autoCorrect={false}
          {...(fieldErrors.code === undefined ? {} : { error: fieldErrors.code })} />
        <TextField testID="redeem-name" label={strings.auth.redeemName} accessibilityLabel={strings.auth.redeemName}
          ref={nameInput} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { emailInput.current?.focus(); }}
          value={name} onChangeText={setName} maxLength={40} autoCapitalize="words" autoComplete="name"
          {...(fieldErrors.name === undefined ? {} : { error: fieldErrors.name })} />
        <TextField testID="redeem-email" label={strings.auth.redeemEmail} accessibilityLabel={strings.auth.redeemEmail}
          ref={emailInput} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { passwordInput.current?.focus(); }}
          value={email} onChangeText={setEmail} maxLength={254} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} autoComplete="email"
          {...(fieldErrors.email === undefined ? {} : { error: fieldErrors.email })} />
        <TextField testID="redeem-password" label={strings.auth.password} accessibilityLabel={strings.auth.password}
          ref={passwordInput} returnKeyType="done" onSubmitEditing={() => { void submit(); }}
          value={password} onChangeText={setPassword} maxLength={128} secureTextEntry
          autoCapitalize="none" autoCorrect={false} autoComplete="new-password"
          {...(fieldErrors.password === undefined ? {} : { error: fieldErrors.password })} />
        <Button testID="redeem-submit" label={strings.auth.redeem} accessibilityLabel={strings.auth.redeem}
          onPress={() => { void submit(); }} loading={pending} active={active} />
        {error !== null && <Text color="danger" accessibilityRole="alert">{error}</Text>}
      </View>
    </KeyboardAwareForm>
    <Sheet visible={discardCount !== null} active={active} accessibilityLabel={strings.auth.discardTitle}
      dismissLabel={strings.dismiss} onDismiss={() => { decideDiscard(false); }}>
      <Text variant="heading">{strings.auth.discardTitle}</Text>
      <Text>{strings.auth.discardBody(discardCount ?? 0)}</Text>
      <Button testID="login-discard-confirm" label={strings.auth.discardConfirm} accessibilityLabel={strings.auth.discardConfirm}
        onPress={() => { decideDiscard(true); }} active={active} />
    </Sheet>
  </View>;
}
