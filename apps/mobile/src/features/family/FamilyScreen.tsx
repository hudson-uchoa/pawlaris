import type { Family, Member } from '@pawlaris/shared';
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { View, type TextInput } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { FamilyActionError } from '../../auth/familyActions';
import { formatValidationError } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { selectMembers } from '../../replica/selectors';
import { useReplica } from '../../replica/useReplica';
import { Button } from '../../ui/primitives/Button';
import { KeyboardAwareForm } from '../../ui/primitives/KeyboardAwareForm';
import { Chip } from '../../ui/primitives/Chip';
import { SegmentedControl } from '../../ui/primitives/SegmentedControl';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Switch } from '../../ui/primitives/Switch';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';
import { accountAvailability, type AccountAction } from './accountAvailability';
import timezones from './timezones.json';
import type { FamilyInvite, FamilyScreenProps } from './types';

// Q-46: the user's own member row offers name editing; colour is fixed.
export function FamilyScreen(props: FamilyScreenProps): ReactElement {
  const family = useReplica((state) => state.family);
  const members = useReplica(selectMembers);
  if (family === null) return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />;
  return <FamilyForm {...props} family={family} members={members} />;
}

function FamilyForm({ services, active, family, members }: FamilyScreenProps & {
  family: Family; members: Member[];
}): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const connection = useSyncExternalStore(services.connection.subscribe, services.connection.getState);
  const user = services.sessionUser();
  const me = members.find((member) => member.id === user.id);
  const leader = (me?.role ?? user.role) === 'leader';
  const availability = accountAvailability('name', connection);
  const online = connection.status === 'synced' || connection.status === 'syncing';
  const [name, setName] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [timezonePicker, setTimezonePicker] = useState(false);
  const [query, setQuery] = useState('');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<Member['role']>('member');
  const [invite, setInvite] = useState<FamilyInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const timezoneInput = useRef<TextInput>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  function run(id: string, action: AccountAction | 'family' | 'copy', operation: () => Promise<void>): void {
    if (!active || running.current) return;
    if (action !== 'copy') {
      const current = services.connection.getState();
      if (current.status !== 'synced' && current.status !== 'syncing') return;
      if (action !== 'family' && accountAvailability(action, current) !== 'available') return;
      if (action !== 'name' && !leader) return;
    }
    running.current = true;
    setBusy(id);
    setError(null);
    void operation().catch((failure: unknown) => {
      if (alive.current) setError(failure instanceof FamilyActionError && failure.code === 'last_leader'
        ? strings.family.lastLeader : failure instanceof FamilyActionError && failure.code === 'forbidden'
          ? strings.family.forbidden : strings.settings.operationFailed);
    }).finally(() => {
      running.current = false;
      if (alive.current) setBusy(null);
    });
  }

  function saveFamily(): void {
    const nextName = name ?? family.name;
    const nextTimezone = timezone ?? family.timezone;
    if ([...nextName].length < 1 || [...nextName].length > 60) { setError(strings.family.invalidName); return; }
    try { new Intl.DateTimeFormat('en', { timeZone: nextTimezone }); }
    catch { setError(strings.family.invalidTimezone); return; }
    run('family-save', 'family', async () => {
      await services.actions.patchFamily({ name: nextName, timezone: nextTimezone });
      if (alive.current) { setName(null); setTimezone(null); }
    });
  }

  function saveProfile(): void {
    if (profileName === null) return;
    const length = [...profileName].length;
    if (length < 1 || length > 40) {
      setError(formatValidationError({ field: 'name', code: length === 0 ? 'required' : 'out_of_range' }));
      return;
    }
    run('member-name-save', 'name', async () => {
      await services.actions.patchProfile({ display_name: profileName });
      if (alive.current) setProfileName(null);
    });
  }

  const accountDisabled = availability !== 'available' || busy !== null;
  const familyDisabled = !online || busy !== null;
  const timezoneOptions = query.trim() === ''
    ? [...new Set(['America/Sao_Paulo', family.timezone, 'America/Manaus', 'America/Recife', 'UTC'])]
    : timezones.filter((zone) => zone.toLowerCase().includes(query.trim().toLowerCase()));
  return <KeyboardAwareForm style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    {availability !== 'available' && <Text testID={`${availability}-note`} color="textMuted">
      {availability === 'offline' ? strings.settings.offlineNote : strings.settings.reserveNote}
    </Text>}
    {leader ? <>
      <TextField testID="family-name" label={strings.family.name} accessibilityLabel={strings.family.name}
        returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { timezoneInput.current?.focus(); }}
        value={name ?? family.name} onChangeText={setName} disabled={familyDisabled} />
      <TextField testID="family-timezone" label={strings.family.timezone} accessibilityLabel={strings.family.timezone}
        ref={timezoneInput} returnKeyType="done" onSubmitEditing={saveFamily}
        value={timezone ?? family.timezone} onChangeText={setTimezone} disabled={familyDisabled}
        autoCapitalize="none" autoCorrect={false} />
      <Button testID="family-timezone-choose" label={strings.family.chooseTimezone}
        accessibilityLabel={strings.family.chooseTimezone} active={active} disabled={familyDisabled}
        onPress={() => { setQuery(''); setTimezonePicker(true); }} />
      <Button testID="family-save" label={strings.settings.save} accessibilityLabel={strings.settings.save}
        active={active} disabled={familyDisabled} loading={busy === 'family-save'} onPress={saveFamily} />
    </> : <><Text>{family.name}</Text><Text color="textMuted">{family.timezone}</Text></>}
    <Text variant="heading" accessibilityRole="header">{strings.family.members}</Text>
    {members.map((member) => <View key={member.id} testID={`member-${member.id}`} style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <View accessible={false} style={{ width: spacing.sm, height: spacing.sm,
          borderRadius: radius.avatar, backgroundColor: member.color }} />
        <Text style={{ flex: 1 }}>{member.display_name}</Text>
        <Text variant="caption" color="textMuted">{strings.family.roles[member.role]}</Text>
      </View>
      {member.disabled_at !== null ? <Text variant="caption" color="textMuted">{strings.family.disabled}</Text> : <>
        {member.id === user.id && <Button testID="member-name-edit" label={strings.settings.editName}
          accessibilityLabel={strings.settings.editName} active={active} disabled={accountDisabled}
          onPress={() => { setError(null); setProfileName(member.display_name); }} />}
        {leader && <>
          <Switch testID={`member-role-${member.id}`} label={strings.family.roles.leader}
            accessibilityLabel={strings.family.role(member.display_name)} value={member.role === 'leader'}
            active={active} disabled={accountDisabled} onValueChange={(value) => {
              run(`member-role-${member.id}`, 'role', () => services.actions.changeRole(member.id, value ? 'leader' : 'member'));
            }} />
          <Button testID={`member-remove-${member.id}`} label={strings.settings.remove}
            accessibilityLabel={strings.family.remove(member.display_name)} active={active} disabled={accountDisabled}
            loading={busy === `member-remove-${member.id}`}
            onPress={() => { run(`member-remove-${member.id}`, 'remove', () => services.actions.removeMember(member.id)); }} />
        </>}
      </>}
    </View>)}
    {leader && <Button testID="invite-create" label={strings.settings.invite} accessibilityLabel={strings.settings.invite}
      active={active} disabled={accountDisabled} onPress={() => { setError(null); setInvite(null); setCopied(false); setInviteOpen(true); }} />}
    {error !== null && <Text accessibilityRole="alert" color="danger">{error}</Text>}
    <Sheet visible={timezonePicker && leader} active={active} accessibilityLabel={strings.family.chooseTimezone}
      dismissLabel={strings.dismiss} onDismiss={() => { setTimezonePicker(false); }}>
      <TextField label={strings.family.searchTimezone} accessibilityLabel={strings.family.searchTimezone}
        value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} disabled={familyDisabled} />
      {timezoneOptions.map((zone) => <Chip key={zone} label={zone} accessibilityLabel={zone} active={active}
        selected={zone === (timezone ?? family.timezone)} disabled={familyDisabled}
        onPress={() => { setTimezone(zone); setTimezonePicker(false); }} />)}
    </Sheet>
    <Sheet visible={profileName !== null} active={active} accessibilityLabel={strings.settings.editName}
      dismissLabel={strings.dismiss} onDismiss={() => { if (busy === null) setProfileName(null); }}>
      <TextField testID="member-name" label={strings.family.displayName} accessibilityLabel={strings.family.displayName}
        returnKeyType="done" onSubmitEditing={saveProfile}
        value={profileName ?? ''} onChangeText={setProfileName} disabled={accountDisabled} />
      <Button testID="member-name-save" label={strings.settings.save} accessibilityLabel={strings.settings.save}
        active={active} disabled={accountDisabled} loading={busy === 'member-name-save'} onPress={saveProfile} />
      {error !== null && <Text accessibilityRole="alert" color="danger">{error}</Text>}
    </Sheet>
    <Sheet visible={inviteOpen && leader} active={active} accessibilityLabel={strings.settings.invite}
      dismissLabel={strings.dismiss} onDismiss={() => { if (busy === null) setInviteOpen(false); }}>
      {invite === null ? <>
        <SegmentedControl options={(['member', 'leader'] as const).map((role) => ({ value: role, label: strings.family.roles[role] }))}
          value={inviteRole} accessibilityLabel={strings.family.inviteRole} disabled={accountDisabled} active={active}
          onValueChange={(value) => { if (value === 'leader' || value === 'member') setInviteRole(value); }} />
        <Button testID="invite-submit" label={strings.settings.invite} accessibilityLabel={strings.settings.invite}
          active={active} disabled={accountDisabled} loading={busy === 'invite-submit'} onPress={() => {
            run('invite-submit', 'invite', async () => {
              const result = await services.actions.invite(inviteRole);
              if (alive.current && result !== undefined) setInvite(result);
            });
          }} />
      </> : <>
        <Text testID="invite-code" variant="display" selectable>{invite.code}</Text>
        <Text>{strings.family.inviteValidity}</Text>
        <Button testID="invite-copy" label={copied ? strings.family.copied : strings.family.copy}
          accessibilityLabel={strings.family.copy} active={active} disabled={busy !== null || services.copyText === undefined}
          onPress={() => { run('invite-copy', 'copy', async () => {
            await services.copyText?.(invite.code);
            if (alive.current) setCopied(true);
          }); }} />
      </>}
      {error !== null && <Text accessibilityRole="alert" color="danger">{error}</Text>}
    </Sheet>
  </KeyboardAwareForm>;
}
