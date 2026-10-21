import { PET_BREEDS, PET_COATS, searchPetList, type Pet, type PetListKind } from '@pawlaris/shared';
import { useState, type ReactElement, type Ref } from 'react';
import { View, type TextInput } from 'react-native';
import { formatPetListValue } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { borderWidth } from '../../ui/tokens/elevation';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';

type PetListPickerProps = {
  kind: PetListKind;
  species: Pet['species'] | '';
  value: string;
  active: boolean;
  error?: string;
  inputRef?: Ref<TextInput>;
  onSubmitEditing(): void;
  onChange(value: string): void;
};

export function PetListPicker({ kind, species, value, active, error, inputRef, onSubmitEditing, onChange }: PetListPickerProps): ReactElement {
  const { color } = useTheme();
  const keys = species === '' ? [] : (kind === 'breed' ? PET_BREEDS : PET_COATS)[species];
  const options = species === '' ? [] : keys.map((key) => ({ key, name: formatPetListValue(species, kind, key) }));
  const [freeText, setFreeText] = useState(() => value !== '' && !options.some((option) => option.key === value));
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const label = kind === 'breed' ? strings.pets.breed : strings.pets.color;
  const testID = `pet-${kind}`;
  function open(): void {
    setQuery('');
    setVisible(true);
  }
  return <View style={{ gap: spacing.xs }}>
    {freeText ? <>
      <TextField testID={testID} label={label} accessibilityLabel={label} disabled={species === ''}
        ref={inputRef} returnKeyType="next" submitBehavior="submit" onSubmitEditing={onSubmitEditing}
        value={value} onChangeText={onChange} {...(error === undefined ? {} : { error })} />
      <Button label={strings.pets.choose} accessibilityLabel={`${strings.pets.choose} ${label}`}
        active={active} disabled={species === ''} onPress={open} />
    </> : <>
      <Text variant="label">{label}</Text>
      <PressableScale testID={testID} accessibilityLabel={label} active={active} disabled={species === ''}
        onPress={open} style={{ borderWidth, borderColor: error === undefined ? color.textMuted : color.danger,
          borderRadius: radius.chip, backgroundColor: species === '' ? color.surfaceSunken : color.surface,
          paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
        <Text>{value === '' || species === '' ? strings.pets.choose : formatPetListValue(species, kind, value)}</Text>
      </PressableScale>
      {error !== undefined && <Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text>}
    </>}
    <Sheet visible={visible} active={active} accessibilityLabel={label} dismissLabel={strings.dismiss}
      onDismiss={() => { setVisible(false); }}>
      <Text variant="heading">{label}</Text>
      <TextField testID={`${testID}-search`} label={strings.pets.search} accessibilityLabel={strings.pets.search}
        value={query} onChangeText={setQuery} />
      {searchPetList(options, query).map((option) => <Button key={option.key} label={option.name}
        accessibilityLabel={option.name} active={active} onPress={() => {
          onChange(option.key);
          setFreeText(false);
          setVisible(false);
        }} />)}
      <Button label={strings.pets.other} accessibilityLabel={strings.pets.other} active={active} onPress={() => {
        if (!freeText) onChange('');
        setFreeText(true);
        setVisible(false);
      }} />
    </Sheet>
  </View>;
}
