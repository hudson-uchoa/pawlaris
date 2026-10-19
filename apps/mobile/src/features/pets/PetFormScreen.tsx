import { localDate, validatePet, type FormValidationError, type Pet } from '@pawlaris/shared';
import { Camera } from 'lucide-react-native';
import { useContext, useRef, useState, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AssetImage } from '../../assets/AssetImage';
import { formatFullDate, formatValidationError } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { Avatar } from '../../ui/primitives/Avatar';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { SegmentedControl } from '../../ui/primitives/SegmentedControl';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { BirthdatePicker } from './BirthdatePicker';
import type { PetScreenProps } from './types';

export type PetFormScreenProps = PetScreenProps & {
  petId?: string;
  avatarAssetId?: string;
  onClose(): void;
  onAvatar(): void;
};

export function PetFormScreen(props: PetFormScreenProps): ReactElement {
  const family = useReplica((state) => state.family);
  const pet = useReplica((state) => props.petId === undefined ? null : state.pets[props.petId] ?? null);
  const user = props.services.sessionUser();
  const leader = useReplica((state) => state.members[user.id]?.role === 'leader');
  if (family === null || (props.petId !== undefined && pet === null)) {
    return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />;
  }
  return <PetForm key={props.petId ?? 'new'} {...props} pet={pet} leader={leader}
    today={localDate(props.services.clock.now(), family.timezone)} />;
}

type Draft = {
  name: string;
  species: Pet['species'] | '';
  sex: Pet['sex'];
  breed: string;
  color: string;
  birthdate: string | null;
  microchip_id: string;
  notes: string;
  avatar_asset_id: string | null;
};

function PetForm({ services, active, onClose, onAvatar, avatarAssetId, pet, leader, today }: PetFormScreenProps & {
  pet: Pet | null; leader: boolean; today: string;
}): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: pet?.name ?? '', species: pet?.species ?? '', sex: pet?.sex ?? 'unknown',
    breed: pet?.breed ?? '', color: pet?.color ?? '', birthdate: pet?.birthdate ?? null,
    microchip_id: pet?.microchip_id ?? '', notes: pet?.notes ?? '', avatar_asset_id: pet?.avatar_asset_id ?? null,
  }));
  const [errors, setErrors] = useState<FormValidationError[]>([]);
  const [pickingDate, setPickingDate] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const finished = useRef(false);
  const avatarId = avatarAssetId ?? draft.avatar_asset_id;
  function update<K extends keyof Draft>(field: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => current.filter((error) => error.field !== field));
  }
  function errorFor(field: keyof Draft): { error?: string } {
    const error = errors.find((entry) => entry.field === field);
    return error === undefined ? {} : { error: formatValidationError(error) };
  }
  function save(): void {
    if (finished.current) return;
    const fields = { name: draft.name, sex: draft.sex, breed: draft.breed || null, color: draft.color || null,
      birthdate: draft.birthdate, microchip_id: draft.microchip_id || null, notes: draft.notes || null,
      avatar_asset_id: avatarId };
    const nextErrors = validatePet({ ...fields, name: draft.name || undefined, species: draft.species || undefined });
    setErrors(nextErrors);
    if (nextErrors.length > 0 || (draft.species !== 'cat' && draft.species !== 'dog')) return;
    if (pet === null) services.mutations.createPet({ ...fields, species: draft.species });
    else services.mutations.patchPet(pet.id, fields);
    finished.current = true;
    onClose();
  }
  const photoPlaceholder = pet === null ? <Icon glyph={Camera} />
    : <Avatar petId={pet.id} species={pet.species} accessibilityLabel={strings.pets.photo} />;
  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    <PressableScale testID="pet-avatar" accessibilityLabel={strings.pets.photo} onPress={onAvatar} active={active}
      style={{ alignItems: 'center', gap: spacing.xs }}>
      <View style={{ width: spacing.xxl, height: spacing.xxl }}>
        {avatarId === null ? photoPlaceholder
          : <AssetImage assetId={avatarId} accessibilityLabel={strings.pets.photo} placeholder={photoPlaceholder} />}
      </View>
      <Text variant="label">{strings.pets.photo}</Text>
    </PressableScale>
    <TextField testID="pet-name" label={strings.pets.name} accessibilityLabel={strings.pets.name}
      value={draft.name} onChangeText={(value) => { update('name', value); }} {...errorFor('name')} />
    <View testID="pet-species" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.pets.species}</Text>
      <SegmentedControl accessibilityLabel={strings.pets.species} value={draft.species} disabled={pet !== null} active={active}
        options={[{ value: 'cat', label: strings.pets.cat }, { value: 'dog', label: strings.pets.dog }]}
        onValueChange={(value) => { if (pet === null && (value === 'cat' || value === 'dog')) update('species', value); }} />
      {errorFor('species').error !== undefined && <Text color="danger" accessibilityRole="alert">{errorFor('species').error}</Text>}
    </View>
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.pets.sex}</Text>
      <SegmentedControl accessibilityLabel={strings.pets.sex} value={draft.sex} active={active}
      options={[{ value: 'female', label: strings.pets.female }, { value: 'male', label: strings.pets.male },
        { value: 'unknown', label: strings.pets.unknownSex }]}
      onValueChange={(value) => { if (value === 'female' || value === 'male' || value === 'unknown') update('sex', value); }} />
    </View>
    {(['breed', 'color'] as const).map((field) => <TextField key={field} label={strings.pets[field]} accessibilityLabel={strings.pets[field]}
      value={draft[field]} onChangeText={(value) => { update(field, value); }} {...errorFor(field)} />)}
    <PressableScale accessibilityLabel={strings.pets.birthdate} active={active} onPress={() => { setPickingDate(true); }}>
      <Text variant="label">{strings.pets.birthdate}</Text>
      {draft.birthdate !== null && <Text>{formatFullDate(draft.birthdate)}</Text>}
    </PressableScale>
    <TextField label={strings.pets.microchip} accessibilityLabel={strings.pets.microchip} value={draft.microchip_id}
      onChangeText={(value) => { update('microchip_id', value); }} {...errorFor('microchip_id')} />
    <TextField label={strings.pets.notes} accessibilityLabel={strings.pets.notes} value={draft.notes} multiline
      onChangeText={(value) => { update('notes', value); }} {...errorFor('notes')} />
    <Button testID="pet-save" label={strings.pets.save} accessibilityLabel={strings.pets.save} onPress={save} active={active} />
    {pet !== null && leader && <Button testID="pet-archive" label={strings.pets.archive} accessibilityLabel={strings.pets.archive}
      onPress={() => { setArchiving(true); }} active={active} />}
    <BirthdatePicker value={draft.birthdate} today={today} active={active} visible={pickingDate}
      onChoose={(value) => { update('birthdate', value); setPickingDate(false); }} onDismiss={() => { setPickingDate(false); }} />
    <Sheet visible={archiving && leader} active={active} accessibilityLabel={strings.pets.archive}
      dismissLabel={strings.dismiss} onDismiss={() => { setArchiving(false); }}>
      <Text variant="heading">{strings.pets.archive}</Text>
      <Text>{strings.pets.archiveBody(pet?.name ?? '')}</Text>
      <Button label={strings.pets.archive} accessibilityLabel={strings.pets.archive} active={active} onPress={() => {
        if (pet === null || !leader || finished.current) return;
        services.mutations.archivePet(pet.id);
        finished.current = true;
        setArchiving(false);
        onClose();
      }} />
    </Sheet>
  </ScrollView>;
}
