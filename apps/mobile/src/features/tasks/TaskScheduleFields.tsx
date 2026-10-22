import type { FormValidationError, Recurrence } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { formatValidationError } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { SegmentedControl } from '../../ui/primitives/SegmentedControl';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { e2eIDs } from '../shell/e2eIDs';
import { TaskDateField } from './TaskDateTimePicker';

const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const frequencies = ['daily', 'weekly', 'monthly', 'once'] as const;

type TaskScheduleFieldsProps = {
  recurrence: Recurrence;
  startsOn: string;
  timezone: string;
  active: boolean;
  disabled: boolean;
  errors: readonly FormValidationError[];
  onChange(value: Recurrence): void;
};

export function TaskScheduleFields({ recurrence, startsOn, timezone, active, disabled,
  errors, onChange }: TaskScheduleFieldsProps): ReactElement {
  function changeFrequency(value: string): void {
    if (disabled || value === recurrence.freq) return;
    const interval = recurrence.freq === 'once' ? 1 : recurrence.interval;
    switch (value) {
      case 'daily': onChange({ freq: value, interval }); break;
      case 'weekly': onChange({ freq: value, interval, byday: [] }); break;
      case 'monthly': onChange({ freq: value, interval, bymonthday: [] }); break;
      case 'once': onChange({ freq: value, date: startsOn }); break;
    }
  }
  return <View style={{ gap: spacing.md }}>
    <View testID="task-freq" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.frequency}</Text>
      <SegmentedControl accessibilityLabel={strings.tasks.frequency} value={recurrence.freq}
        options={frequencies.map((value) => ({ value, label: strings.tasks.frequencies[value] }))}
        disabled={disabled} active={active} onValueChange={changeFrequency} />
    </View>
    {recurrence.freq !== 'once' && <View testID="task-interval" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.interval(recurrence.interval, strings.format.intervalUnits[recurrence.freq])}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label={strings.tasks.decrease} accessibilityLabel={strings.tasks.decreaseInterval} active={active}
          disabled={disabled || recurrence.interval <= 1} onPress={() => {
            if (!disabled && recurrence.interval > 1) onChange({ ...recurrence, interval: recurrence.interval - 1 });
          }} />
        <Button testID={e2eIDs.intervalIncrease} label={strings.tasks.increase} accessibilityLabel={strings.tasks.increaseInterval} active={active}
          disabled={disabled || recurrence.interval >= 365} onPress={() => {
            if (!disabled && recurrence.interval < 365) onChange({ ...recurrence, interval: recurrence.interval + 1 });
          }} />
      </View>
    </View>}
    {recurrence.freq === 'weekly' && <View testID="task-weekdays" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.weekdays}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {weekdays.map((day) => <View key={day} style={{ width: `${100 / 7}%`, paddingVertical: spacing.xxs }}>
          <Chip label={strings.tasks.weekdayInitials[day]}
            accessibilityLabel={strings.tasks.weekdayNames[day]} selected={recurrence.byday.includes(day)}
            disabled={disabled} active={active} onPress={() => {
              if (disabled) return;
              const selected = new Set(recurrence.byday);
              if (selected.has(day)) selected.delete(day); else selected.add(day);
              onChange({ ...recurrence, byday: weekdays.filter((entry) => selected.has(entry)) });
            }} />
        </View>)}
      </View>
    </View>}
    {recurrence.freq === 'monthly' && <View testID="task-monthdays" style={{ gap: spacing.xs }}>
      <Text variant="label">{strings.tasks.monthDays}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <View key={day}
          style={{ width: `${100 / 7}%`, paddingVertical: spacing.xxs }}>
          <Chip label={String(day)} accessibilityLabel={strings.tasks.monthDay(day)}
            selected={recurrence.bymonthday.includes(day)} disabled={disabled} active={active} onPress={() => {
              if (disabled) return;
              const selected = recurrence.bymonthday.includes(day)
                ? recurrence.bymonthday.filter((entry) => entry !== day) : [...recurrence.bymonthday, day];
              onChange({ ...recurrence, bymonthday: selected.sort((a, b) => a - b) });
            }} />
        </View>)}
      </View>
    </View>}
    {recurrence.freq === 'once' && <TaskDateField value={recurrence.date} label={strings.tasks.date}
      testID="task-once-date" timezone={timezone} active={active} disabled={disabled}
      onChoose={(date) => { if (!disabled) onChange({ freq: 'once', date }); }} />}
    {errors.filter((error) => ['freq', 'interval', 'byday', 'bymonthday', 'date'].includes(error.field))
      .map((error) => <Text key={`${error.field}:${error.code}`} color="danger" accessibilityRole="alert">
        {formatValidationError(error)}
      </Text>)}
  </View>;
}
