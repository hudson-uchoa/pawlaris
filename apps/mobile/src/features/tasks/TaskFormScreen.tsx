import {
  buildEnd, classifyTaskEdit, forkEffectiveDate, localDate, localTime, validateTask,
  type FormValidationError, type TaskEdits, type TaskTemplate,
} from '@pawlaris/shared';
import { useContext, useRef, useState, type ReactElement } from 'react';
import { View, type TextInput } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AssetImage } from '../../assets/AssetImage';
import { formatTaskEffectiveDate, formatValidationError } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { selectMembers, selectPets } from '../../replica/selectors';
import { useReplica } from '../../replica/useReplica';
import { Avatar } from '../../ui/primitives/Avatar';
import { Button } from '../../ui/primitives/Button';
import { KeyboardAwareForm } from '../../ui/primitives/KeyboardAwareForm';
import { Chip } from '../../ui/primitives/Chip';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { SegmentedControl } from '../../ui/primitives/SegmentedControl';
import { Sheet } from '../../ui/primitives/Sheet';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Switch } from '../../ui/primitives/Switch';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { useTheme } from '../../ui/theme';
import { borderWidth } from '../../ui/tokens/elevation';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';
import { TaskDateField, TaskDateTimePicker } from './TaskDateTimePicker';
import { TaskScheduleFields } from './TaskScheduleFields';
import type { TaskScreenProps } from './types';

export type TaskFormScreenProps = TaskScreenProps & {
  taskId?: string;
  initialPetId?: string;
  initialCategory?: TaskTemplate['category'];
  onClose(): void;
};

export function TaskFormScreen(props: TaskFormScreenProps): ReactElement {
  const family = useReplica((state) => state.family);
  const task = useReplica((state) => props.taskId === undefined ? null : state.taskTemplates[props.taskId] ?? null);
  if (family === null || (props.taskId !== undefined && task === null)) {
    return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 3} active={props.active} />;
  }
  return <TaskForm key={props.taskId ?? 'new'} {...props} task={task} timezone={family.timezone} />;
}

type Draft = Required<TaskEdits>;
const categories = ['feeding', 'medication', 'hygiene', 'litter', 'play', 'vet', 'other'] as const;
const modes = ['together', 'per_pet'] as const;
const reminders = ['routine', 'critical'] as const;

function TaskForm({ services, active, task, timezone, onClose, initialPetId, initialCategory }: TaskFormScreenProps & {
  task: TaskTemplate | null;
  timezone: string;
}): ReactElement {
  const { color } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const user = services.sessionUser();
  const leader = useReplica((state) => state.members[user.id]?.role === 'leader');
  const pets = useReplica(selectPets);
  const members = useReplica(selectMembers);
  const completions = useReplica((state) => state.completions);
  const today = localDate(services.clock.now(), timezone);
  const canEdit = leader || task === null || task.created_by === user.id;
  const hasCompletions = task !== null && Object.values(completions).some((row) => row.task_id === task.id);
  const effective = task === null ? today : forkEffectiveDate({ template: task,
    completions: Object.values(completions), today });
  const [draft, setDraft] = useState<Draft>(() => ({
    title: task?.title ?? '', description: task?.description ?? null, category: task?.category ?? initialCategory ?? 'other',
    assigned_to: task?.assigned_to ?? null, requires_photo: task?.requires_photo ?? false,
    timer_seconds: task?.timer_seconds ?? null, reminder_class: task?.reminder_class ?? 'routine',
    sort_order: task?.sort_order ?? 0, recurrence: task?.recurrence ?? { freq: 'daily', interval: 1 },
    starts_on: task?.starts_on ?? today, times_of_day: task?.times_of_day ?? [],
    pet_ids: task?.pet_ids ?? pets.filter((pet) => pet.id === initialPetId && pet.archived_at === null).map((pet) => pet.id),
    completion_mode: task?.completion_mode ?? 'together',
  }));
  const [timerMinutes, setTimerMinutes] = useState(task?.timer_seconds == null ? '1' : String(task.timer_seconds / 60));
  const [errors, setErrors] = useState<FormValidationError[]>([]);
  const [pickingTime, setPickingTime] = useState(false);
  const [ending, setEnding] = useState(false);
  const finished = useRef(false);
  const timerInput = useRef<TextInput>(null);
  const descriptionInput = useRef<TextInput>(null);
  const fields: Draft = { ...draft, completion_mode: draft.pet_ids.length === 1 ? 'together' : draft.completion_mode };
  const scheduleEdit = task !== null && classifyTaskEdit(task, fields) === 'schedule';

  function clearErrors(...names: string[]): void {
    setErrors((current) => current.filter((error) => !names.includes(error.field)));
  }
  function update<K extends keyof Draft>(field: K, value: Draft[K]): void {
    if (!canEdit || finished.current) return;
    setDraft((current) => ({ ...current, [field]: value }));
    clearErrors(field);
  }
  function fieldError(field: string): { error?: string } {
    const error = errors.find((entry) => entry.field === field);
    return error === undefined ? {} : { error: formatValidationError(error) };
  }
  function effectiveDate(): string {
    return task === null ? localDate(services.clock.now(), timezone) : forkEffectiveDate({
      template: task, completions: Object.values(completions), today: localDate(services.clock.now(), timezone),
    });
  }
  function save(): void {
    if (!canEdit || finished.current) return;
    const nextErrors = validateTask({ ...fields, title: fields.title || undefined });
    setErrors(nextErrors);
    if (nextErrors.length > 0 || (!leader && fields.assigned_to !== null && fields.assigned_to !== user.id)) return;
    if (task === null) services.mutations.createTask(fields);
    else if (classifyTaskEdit(task, fields) === 'schedule') {
      services.mutations.forkTask(task.id, fields, effectiveDate());
    } else {
      const { title, description, category, assigned_to, requires_photo, timer_seconds, reminder_class, sort_order } = fields;
      services.mutations.patchTask(task.id, {
        title, description, category, assigned_to, requires_photo, timer_seconds, reminder_class, sort_order,
      });
    }
    finished.current = true;
    onClose();
  }
  function addTime(time: string): void {
    if (!canEdit || finished.current) return;
    const times = [...draft.times_of_day, time].sort();
    const nextErrors = validateTask({ ...fields, times_of_day: times }).filter((error) => error.field === 'times_of_day');
    setErrors((current) => [...current.filter((error) => error.field !== 'times_of_day'), ...nextErrors]);
    if (nextErrors.length === 0) setDraft((current) => ({ ...current, times_of_day: times }));
  }

  return <KeyboardAwareForm style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.md + (insets?.top ?? 0),
      paddingBottom: spacing.md + (insets?.bottom ?? 0), gap: spacing.md }}>
    {!canEdit && <Text>{strings.tasks.readOnly}</Text>}
    <TextField testID="task-title" label={strings.tasks.title} accessibilityLabel={strings.tasks.title}
      returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => {
        (draft.timer_seconds === null ? descriptionInput : timerInput).current?.focus();
      }}
      value={draft.title} disabled={!canEdit} onChangeText={(value) => { update('title', value); }} {...fieldError('title')} />
    <View testID="task-category" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.category}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {categories.map((category) => <Chip key={category} label={strings.tasks.categories[category]}
          accessibilityLabel={strings.tasks.categories[category]} selected={draft.category === category}
          disabled={!canEdit} active={active} onPress={() => {
            if (!canEdit || finished.current) return;
            setDraft((current) => ({ ...current, category,
              ...(category === 'medication' ? { completion_mode: 'per_pet', reminder_class: 'critical' } as const : {}),
            }));
            clearErrors('category', 'completion_mode', 'reminder_class');
          }} />)}
      </View>
    </View>
    <View testID="task-pets" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.pets}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {pets.filter((pet) => pet.archived_at === null).map((pet) => {
          const selected = draft.pet_ids.includes(pet.id);
          const avatar = <Avatar petId={pet.id} identityColor={pet.identity_color} species={pet.species} accessibilityLabel={pet.name} />;
          return <PressableScale key={pet.id} accessibilityLabel={pet.name} active={active} disabled={!canEdit}
            accessibilityState={{ selected }} onPress={() => {
              if (!canEdit || finished.current) return;
              const petIds = selected ? draft.pet_ids.filter((id) => id !== pet.id) : [...draft.pet_ids, pet.id];
              setDraft((current) => ({ ...current, pet_ids: petIds,
                completion_mode: petIds.length === 1 ? 'together' : current.completion_mode }));
              clearErrors('pet_ids', 'completion_mode');
            }} style={{ alignItems: 'center', gap: spacing.xs, padding: spacing.xs, borderWidth,
              borderRadius: radius.chip, borderColor: selected ? color.accent : color.textMuted,
              backgroundColor: selected ? color.accentSoft : color.surface }}>
            <View importantForAccessibility="no-hide-descendants" style={{ width: spacing.xxl, height: spacing.xxl,
              overflow: 'hidden', borderRadius: radius.avatar }}>
              {pet.avatar_asset_id === null ? avatar
                : <AssetImage assetId={pet.avatar_asset_id} placeholder={avatar} accessibilityLabel={pet.name} />}
            </View>
            <Text variant="label" color={!canEdit ? 'textMuted' : selected ? 'accent' : 'text'}>{pet.name}</Text>
          </PressableScale>;
        })}
      </View>
      {fieldError('pet_ids').error !== undefined && <Text color="danger" accessibilityRole="alert">{fieldError('pet_ids').error}</Text>}
    </View>
    {draft.pet_ids.length > 1 && <View testID="task-mode" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.mode}</Text>
      <SegmentedControl accessibilityLabel={strings.tasks.mode} value={draft.completion_mode}
        options={modes.map((value) => ({ value, label: strings.tasks.modes[value] }))} disabled={!canEdit} active={active}
        onValueChange={(value) => { if (value === 'together' || value === 'per_pet') update('completion_mode', value); }} />
    </View>}
    <TaskScheduleFields recurrence={draft.recurrence} startsOn={draft.starts_on} timezone={timezone}
      active={active} disabled={!canEdit} errors={errors} onChange={(recurrence) => {
        if (!canEdit || finished.current) return;
        setDraft((current) => ({ ...current, recurrence,
          starts_on: recurrence.freq === 'once' ? recurrence.date : current.starts_on }));
        clearErrors('freq', 'interval', 'byday', 'bymonthday', 'date', 'starts_on');
      }} />
    <View testID="task-times" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.times}</Text>
      {draft.times_of_day.length === 0 && <Text color="textMuted">{strings.format.allDay}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {draft.times_of_day.map((time) => <Chip key={time} label={time}
          accessibilityLabel={strings.tasks.removeTime(time)} disabled={!canEdit} active={active}
          onPress={() => { update('times_of_day', draft.times_of_day.filter((entry) => entry !== time)); }} />)}
      </View>
      <Button label={strings.tasks.addTime} accessibilityLabel={strings.tasks.addTime} active={active}
        disabled={!canEdit || draft.times_of_day.length >= 8} onPress={() => { setPickingTime(true); }} />
      {fieldError('times_of_day').error !== undefined && <Text color="danger" accessibilityRole="alert">{fieldError('times_of_day').error}</Text>}
    </View>
    {task === null && <TaskDateField testID="task-starts" label={strings.tasks.startsOn} value={draft.starts_on}
      timezone={timezone} active={active} disabled={!canEdit} {...fieldError('starts_on')} onChoose={(date) => {
        if (!canEdit || finished.current) return;
        setDraft((current) => ({ ...current, starts_on: date,
          recurrence: current.recurrence.freq === 'once' ? { freq: 'once', date } : current.recurrence }));
        clearErrors('starts_on', 'date');
      }} />}
    <View testID="task-assignee" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.assignee}</Text>
      <SegmentedControl accessibilityLabel={strings.tasks.assignee} value={draft.assigned_to ?? ''}
        disabled={!canEdit} active={active} options={[{ value: '', label: strings.tasks.anyone },
          ...members.filter((member) => member.disabled_at === null).map((member) => ({
            value: member.id, label: member.id === user.id ? user.display_name : member.display_name,
            disabled: !leader && member.id !== user.id,
          }))]} onValueChange={(value) => {
          if (value === '' || value === user.id || (leader && members.some((member) => member.id === value && member.disabled_at === null))) {
            update('assigned_to', value || null);
          }
        }} />
    </View>
    <Switch testID="task-photo" label={strings.tasks.photo} accessibilityLabel={strings.tasks.photo}
      value={draft.requires_photo} disabled={!canEdit} active={active}
      onValueChange={(value) => { update('requires_photo', value); }} />
    <View testID="task-timer" style={{ gap: spacing.xs }}>
      <Switch label={strings.tasks.timer} accessibilityLabel={strings.tasks.timer} value={draft.timer_seconds !== null}
        disabled={!canEdit} active={active} onValueChange={(value) => {
          update('timer_seconds', value ? Number(timerMinutes) * 60 : null);
        }} />
      {draft.timer_seconds !== null && <TextField label={strings.tasks.minutes} accessibilityLabel={strings.tasks.minutes}
        ref={timerInput} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => { descriptionInput.current?.focus(); }}
        value={timerMinutes} disabled={!canEdit} keyboardType="number-pad" onChangeText={(value) => {
          if (!canEdit || finished.current) return;
          setTimerMinutes(value);
          update('timer_seconds', Number(value) * 60);
        }} {...fieldError('timer_seconds')} />}
    </View>
    <View testID="task-reminder" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.reminder}</Text>
      <SegmentedControl accessibilityLabel={strings.tasks.reminder} value={draft.reminder_class}
        disabled={!canEdit} active={active} options={reminders.map((value) => ({ value, label: strings.tasks.reminders[value] }))}
        onValueChange={(value) => { if (value === 'routine' || value === 'critical') update('reminder_class', value); }} />
    </View>
    <TextField label={strings.tasks.description} accessibilityLabel={strings.tasks.description} multiline
      ref={descriptionInput} returnKeyType="done" submitBehavior="submit" onSubmitEditing={save}
      value={draft.description ?? ''} disabled={!canEdit} onChangeText={(value) => { update('description', value || null); }}
      {...fieldError('description')} />
    {canEdit && scheduleEdit && <Text>{formatTaskEffectiveDate(effective, today)}</Text>}
    <Button testID="task-save" label={strings.tasks.save} accessibilityLabel={strings.tasks.save}
      active={active} disabled={!canEdit} onPress={save} />
    {task !== null && canEdit && <Button testID="task-end" label={strings.tasks.end} accessibilityLabel={strings.tasks.end}
      active={active} onPress={() => { setEnding(true); }} />}
    {task !== null && canEdit && !hasCompletions && <Button testID="task-delete" label={strings.tasks.delete}
      accessibilityLabel={strings.tasks.delete} active={active} onPress={() => {
        if (!canEdit || finished.current || hasCompletions) return;
        services.mutations.deleteTask(task.id);
        finished.current = true;
        onClose();
      }} />}
    <Sheet visible={ending && canEdit} active={active} accessibilityLabel={strings.tasks.end}
      dismissLabel={strings.dismiss} onDismiss={() => { setEnding(false); }}>
      <Text variant="heading">{strings.tasks.end}</Text>
      <Text>{strings.tasks.endBody}</Text>
      <Button label={strings.tasks.end} accessibilityLabel={strings.tasks.end} active={active} onPress={() => {
        if (task === null || !canEdit || finished.current) return;
        services.mutations.patchTask(task.id, buildEnd(task, effectiveDate()));
        finished.current = true;
        setEnding(false);
        onClose();
      }} />
    </Sheet>
    {pickingTime && canEdit && <TaskDateTimePicker mode="time" date={today}
      time={localTime(services.clock.now(), timezone)} timezone={timezone} active={active}
      onChoose={addTime} onDismiss={() => { setPickingTime(false); }} />}
  </KeyboardAwareForm>;
}
