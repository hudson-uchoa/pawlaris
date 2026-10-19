import { localDate, localTime, slotInstant } from '@pawlaris/shared';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatFullDate } from '../../i18n/format';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';

type TaskDateTimePickerProps = {
  mode: 'date' | 'time';
  date: string;
  time?: string;
  timezone: string;
  active: boolean;
  onChoose(value: string): void;
  onDismiss(): void;
};

export function TaskDateTimePicker({ mode, date, time = '12:00', timezone, active,
  onChoose, onDismiss }: TaskDateTimePickerProps): ReactElement | null {
  if (!active) return null;
  return <DateTimePicker mode={mode} value={new Date(slotInstant(date, time, timezone))}
    timeZoneName={timezone} is24Hour firstDayOfWeek={1} testID="task-native-picker"
    onDismiss={onDismiss} onValueChange={(_event, value) => {
      onChoose(mode === 'date' ? localDate(value.getTime(), timezone) : localTime(value.getTime(), timezone));
      onDismiss();
    }} />;
}

type TaskDateFieldProps = {
  value: string;
  label: string;
  testID: string;
  timezone: string;
  active: boolean;
  disabled: boolean;
  error?: string;
  onChoose(value: string): void;
};

export function TaskDateField({ value, label, testID, timezone, active, disabled, error,
  onChoose }: TaskDateFieldProps): ReactElement {
  const [picking, setPicking] = useState(false);
  return <View style={{ gap: spacing.xs }}>
    <Text variant="label">{label}</Text>
    <PressableScale testID={testID} accessibilityLabel={label} active={active} disabled={disabled}
      onPress={() => { setPicking(true); }}>
      <Text color={disabled ? 'textMuted' : 'text'}>{formatFullDate(value)}</Text>
    </PressableScale>
    {error !== undefined && <Text color="danger" accessibilityRole="alert">{error}</Text>}
    {picking && !disabled && <TaskDateTimePicker mode="date" date={value} timezone={timezone}
      active={active} onChoose={onChoose} onDismiss={() => { setPicking(false); }} />}
  </View>;
}
