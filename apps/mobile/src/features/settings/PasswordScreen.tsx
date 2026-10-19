import { validatePassword } from '@pawlaris/shared';
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { TextInput } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { PasswordChangeError } from '../../auth/changePassword';
import { formatValidationError } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { KeyboardAwareForm } from '../../ui/primitives/KeyboardAwareForm';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { accountAvailability } from '../family/accountAvailability';
import type { FamilyActions } from '../family/types';
import type { SettingsServices } from './types';

export interface PasswordScreenProps {
  services: SettingsServices & { actions: Pick<FamilyActions, 'changePassword'> };
  active: boolean;
  onClose(): void;
}

export function PasswordScreen({ services, active, onClose }: PasswordScreenProps): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const connection = useSyncExternalStore(services.connection.subscribe, services.connection.getState);
  const availability = accountAvailability('password', connection);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [newError, setNewError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const newPasswordInput = useRef<TextInput>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function save(): Promise<void> {
    if (!active || running.current
      || accountAvailability('password', services.connection.getState()) !== 'available') return;
    const currentError = currentPassword.length === 0
      ? formatValidationError({ field: 'password', code: 'required' }) : undefined;
    const validation = validatePassword(newPassword)[0];
    setCurrentError(currentError);
    setNewError(validation === undefined ? undefined : formatValidationError(validation));
    setError(null);
    if (currentError !== undefined || validation !== undefined) return;
    running.current = true;
    setPending(true);
    try {
      await services.actions.changePassword(currentPassword, newPassword);
      if (alive.current) {
        setCurrentPassword('');
        setNewPassword('');
        onClose();
      }
    } catch (failure) {
      if (alive.current) setError(failure instanceof PasswordChangeError && failure.code === 'invalid_credentials'
        ? strings.settings.incorrectPassword : strings.settings.operationFailed);
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }

  const disabled = availability !== 'available' || pending;
  return <KeyboardAwareForm style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    {availability !== 'available' && <Text testID={`${availability}-note`} color="textMuted">
      {availability === 'offline' ? strings.settings.offlineNote : strings.settings.reserveNote}
    </Text>}
    <TextField testID="password-current" label={strings.settings.currentPassword}
      returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { newPasswordInput.current?.focus(); }}
      accessibilityLabel={strings.settings.currentPassword} value={currentPassword} onChangeText={setCurrentPassword}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" disabled={disabled}
      {...(currentError === undefined ? {} : { error: currentError })} />
    <TextField testID="password-new" label={strings.settings.newPassword}
      ref={newPasswordInput} returnKeyType="done" onSubmitEditing={() => { void save(); }}
      accessibilityLabel={strings.settings.newPassword} value={newPassword} onChangeText={setNewPassword}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" disabled={disabled}
      {...(newError === undefined ? {} : { error: newError })} />
    <Button testID="password-save" label={strings.settings.save} accessibilityLabel={strings.settings.save}
      active={active} disabled={disabled} loading={pending} onPress={() => { void save(); }} />
    {error !== null && <Text color="danger" accessibilityRole="alert">{error}</Text>}
  </KeyboardAwareForm>;
}
