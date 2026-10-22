import { validateHealthEvent, type FormValidationError, type HealthEvent } from '@pawlaris/shared';
import Camera from 'lucide-react-native/icons/camera';
import { useCallback, useContext, useRef, useState, type ReactElement } from 'react';
import { View, type TextInput } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { formatDateTime, formatFullDate, formatValidationError, parseDateTime, parseFullDate } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { Button } from '../../ui/primitives/Button';
import { KeyboardAwareForm } from '../../ui/primitives/KeyboardAwareForm';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { SegmentedControl } from '../../ui/primitives/SegmentedControl';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { HealthAttachment } from './HealthTimelineItem';
import type { HealthScreenProps } from './types';

const eventTypes = ['vaccine', 'medication', 'vet_visit', 'symptom', 'procedure', 'other'] as const;
const typeOptions = eventTypes.map((value) => ({ value, label: strings.health.types[value] }));

export type HealthFormScreenProps = HealthScreenProps & {
  petId: string;
  eventId?: string;
};

export function HealthFormScreen(props: HealthFormScreenProps): ReactElement {
  const family = useReplica((state) => state.family);
  const pet = useReplica((state) => state.pets[props.petId]);
  const event = useReplica((state) => props.eventId === undefined ? null : state.healthEvents[props.eventId] ?? null);
  if (family === null || pet === undefined || (props.eventId !== undefined && event === null)) {
    return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />;
  }
  return <HealthForm key={props.eventId ?? props.petId} {...props} event={event} timezone={family.timezone} />;
}

type Draft = {
  type: HealthEvent['type'] | '';
  title: string;
  when: string;
  nextDue: string;
  notes: string;
};

function HealthForm({ services, petId, active, onClose, onAttachment, attachmentAssetId, event, timezone }: HealthFormScreenProps & {
  event: HealthEvent | null; timezone: string;
}): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const [initialInstant] = useState(() => event === null ? services.clock.now() : Date.parse(event.occurred_at));
  const [draft, setDraft] = useState<Draft>(() => ({
    type: event?.type ?? '', title: event?.title ?? '', when: formatDateTime(initialInstant, timezone),
    nextDue: event?.next_due_on === null || event?.next_due_on === undefined ? '' : formatFullDate(event.next_due_on),
    notes: event?.notes ?? '',
  }));
  const [errors, setErrors] = useState<FormValidationError[]>([]);
  const [deleting, setDeleting] = useState(false);
  const finished = useRef(false);
  const whenInput = useRef<TextInput>(null);
  const nextDueInput = useRef<TextInput>(null);
  const notesInput = useRef<TextInput>(null);
  const photoId = attachmentAssetId ?? event?.attachment_asset_id ?? null;
  const openCamera = useCallback(() => { onAttachment('attachment'); }, [onAttachment]);
  function update<K extends keyof Draft>(field: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function errorFor(field: string): { error?: string } {
    const error = errors.find((entry) => entry.field === field);
    return error === undefined ? {} : { error: formatValidationError(error) };
  }
  function save(): void {
    if (finished.current || deleting) return;
    const instant = draft.when === formatDateTime(initialInstant, timezone) ? initialInstant : parseDateTime(draft.when, timezone);
    const occurredAt = draft.when.trim() === '' ? undefined : instant === null ? null : new Date(instant).toISOString();
    const nextDueOn = draft.nextDue.trim() === '' ? null : parseFullDate(draft.nextDue);
    const fields = { type: draft.type || undefined, title: draft.title || undefined,
      occurred_at: occurredAt, notes: draft.notes || null, attachment_asset_id: photoId,
      next_due_on: draft.nextDue.trim() !== '' && nextDueOn === null ? '' : nextDueOn };
    const nextErrors = validateHealthEvent({ pet_id: petId, ...fields });
    setErrors(nextErrors);
    if (nextErrors.length > 0 || draft.type === '' || occurredAt === null || occurredAt === undefined) return;
    const valid = { ...fields, type: draft.type, title: draft.title, occurred_at: occurredAt };
    if (event === null) services.mutations.createHealthEvent({ pet_id: petId, ...valid });
    else services.mutations.patchHealthEvent(event.id, valid);
    finished.current = true;
    onClose();
  }
  return <KeyboardAwareForm testID="health-form" style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.health.type}</Text>
      <SegmentedControl accessibilityLabel={strings.health.type} value={draft.type} options={typeOptions} active={active}
        onValueChange={(value) => {
          const selected = eventTypes.find((type) => type === value);
          if (selected !== undefined) update('type', selected);
        }} />
      {errorFor('type').error !== undefined && <Text color="danger" accessibilityRole="alert">{errorFor('type').error}</Text>}
    </View>
    <TextField testID="health-title" label={strings.health.title} accessibilityLabel={strings.health.title}
      returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { whenInput.current?.focus(); }}
      value={draft.title} onChangeText={(value) => { update('title', value); }} {...errorFor('title')} />
    <TextField testID="health-occurred-at" label={strings.health.occurredAt} accessibilityLabel={strings.health.occurredAt}
      ref={whenInput} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { nextDueInput.current?.focus(); }}
      placeholder={strings.health.dateTimePlaceholder} value={draft.when}
      onChangeText={(value) => { update('when', value); }} {...errorFor('occurred_at')} />
    <TextField testID="health-next-due-on" label={strings.health.nextDueOn} accessibilityLabel={strings.health.nextDueOn}
      ref={nextDueInput} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { notesInput.current?.focus(); }}
      placeholder={strings.health.datePlaceholder} value={draft.nextDue}
      onChangeText={(value) => { update('nextDue', value); }} {...errorFor('next_due_on')} />
    <TextField testID="health-notes" label={strings.health.notes} accessibilityLabel={strings.health.notes}
      ref={notesInput} returnKeyType="done" submitBehavior="submit" onSubmitEditing={save}
      value={draft.notes} onChangeText={(value) => { update('notes', value); }} multiline {...errorFor('notes')} />
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.pets.photo}</Text>
      {photoId === null ? <PressableScale accessibilityLabel={strings.pets.photo} active={active} onPress={openCamera}
        style={{ width: spacing.xxl, height: spacing.xxl, alignItems: 'center', justifyContent: 'center' }}>
        <Icon glyph={Camera} />
      </PressableScale> : <HealthAttachment assetId={photoId} active={active} onOpen={openCamera} />}
      {errorFor('attachment_asset_id').error !== undefined
        && <Text color="danger" accessibilityRole="alert">{errorFor('attachment_asset_id').error}</Text>}
    </View>
    <Button testID="health-save" label={strings.pets.save} accessibilityLabel={strings.pets.save} onPress={save} active={active} />
    {event !== null && <Button testID="health-delete" label={strings.health.delete} accessibilityLabel={strings.health.delete}
      onPress={() => { if (!finished.current) setDeleting(true); }} active={active} />}
    <Sheet visible={deleting} active={active} accessibilityLabel={strings.health.deleteConfirmation}
      dismissLabel={strings.dismiss} onDismiss={() => { setDeleting(false); }}>
      <Text variant="heading">{strings.health.deleteConfirmation}</Text>
      <Button testID="health-delete-confirm" label={strings.health.delete} accessibilityLabel={strings.health.delete}
        active={active} onPress={() => {
          if (event === null || finished.current) return;
          services.mutations.deleteHealthEvent(event.id);
          finished.current = true;
          setDeleting(false);
          onClose();
        }} />
    </Sheet>
  </KeyboardAwareForm>;
}
