import { needsWeightConfirmation, validateWeight, type FormValidationError } from '@pawlaris/shared';
import { useContext, useRef, useState, type ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatDateTime, formatDecimal, formatValidationError, parseDateTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import type { WeightCreate } from '../../sync/mutations';
import { Button } from '../../ui/primitives/Button';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { petWeights } from './petWeights';
import type { PetScreenProps } from './types';

export type WeightFormScreenProps = PetScreenProps & {
  petId: string;
  onClose(): void;
  onSaved?(): void;
};

export function WeightFormScreen(props: WeightFormScreenProps): ReactElement {
  const family = useReplica((state) => state.family);
  const pet = useReplica((state) => state.pets[props.petId]);
  if (family === null || pet === undefined) {
    return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />;
  }
  return <WeightForm key={props.petId} {...props} timezone={family.timezone} />;
}

function WeightForm({ services, petId, active, onClose, onSaved, timezone }: WeightFormScreenProps & {
  timezone: string;
}): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const latest = useReplica((state) => petWeights(state.weightEntries, petId)[0] ?? null);
  const [initial] = useState(() => services.clock.now());
  const [value, setValue] = useState('');
  const [when, setWhen] = useState(() => formatDateTime(initial, timezone));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormValidationError[]>([]);
  const [confirmation, setConfirmation] = useState<{ previous: number; body: WeightCreate } | null>(null);
  const finished = useRef(false);
  function errorFor(field: string): { error?: string } {
    const error = errors.find((entry) => entry.field === field);
    return error === undefined ? {} : { error: formatValidationError(error) };
  }
  function commit(body: WeightCreate): void {
    if (finished.current) return;
    services.mutations.createWeight(body);
    finished.current = true;
    setConfirmation(null);
    onSaved?.();
    onClose();
  }
  function save(): void {
    if (finished.current || confirmation !== null) return;
    const raw = value.trim();
    const weight = raw === '' ? undefined : /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
    const instant = when === formatDateTime(initial, timezone) ? initial : parseDateTime(when, timezone);
    const measuredAt = when.trim() === '' ? undefined : instant === null ? null : new Date(instant).toISOString();
    const body = { pet_id: petId, weight_kg: weight, measured_at: measuredAt, note: note || null };
    const nextErrors = validateWeight(body);
    // Numeric conversion discards trailing zeroes; retain the input precision rule.
    if (/[.,]\d{3,}$/.test(raw) && !nextErrors.some((error) => error.field === 'weight_kg')) {
      nextErrors.push({ field: 'weight_kg', code: 'out_of_range' });
    }
    setErrors(nextErrors);
    if (nextErrors.length > 0 || weight === undefined || measuredAt === undefined || measuredAt === null) return;
    const valid = { ...body, weight_kg: weight, measured_at: measuredAt };
    if (needsWeightConfirmation(latest?.weight_kg ?? null, weight) && latest !== null) {
      setConfirmation({ previous: latest.weight_kg, body: valid });
    } else commit(valid);
  }
  const message = confirmation === null ? strings.weights.value : strings.weights.confirmation(
    formatDecimal(confirmation.previous, 2), formatDecimal(confirmation.body.weight_kg, 2));
  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    <Text variant="heading" accessibilityRole="header">{strings.weights.add}</Text>
    <TextField testID="weight-value" label={strings.weights.value} accessibilityLabel={strings.weights.value}
      value={value} onChangeText={setValue} keyboardType="decimal-pad" {...errorFor('weight_kg')} />
    <TextField testID="weight-measured-at" label={strings.weights.measuredAt} accessibilityLabel={strings.weights.measuredAt}
      value={when} onChangeText={setWhen} placeholder={strings.weights.dateTimePlaceholder} {...errorFor('measured_at')} />
    <TextField testID="weight-note" label={strings.weights.note} accessibilityLabel={strings.weights.note}
      value={note} onChangeText={setNote} multiline {...errorFor('note')} />
    <Button testID="weight-save" label={strings.pets.save} accessibilityLabel={strings.pets.save} onPress={save} active={active} />
    <Sheet visible={confirmation !== null} active={active} accessibilityLabel={message}
      dismissLabel={strings.dismiss} onDismiss={() => { setConfirmation(null); }}>
      <Text>{message}</Text>
      <Button testID="weight-confirm" label={strings.weights.confirm} accessibilityLabel={strings.weights.confirm}
        active={active} onPress={() => { if (confirmation !== null) commit(confirmation.body); }} />
      <Button label={strings.weights.correct} accessibilityLabel={strings.weights.correct} active={active}
        onPress={() => { setConfirmation(null); }} />
    </Sheet>
  </ScrollView>;
}
