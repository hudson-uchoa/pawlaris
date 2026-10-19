import { daysInMonth, formatDateKey, parseDateKey, weekdayOf, type DateKey } from '@pawlaris/shared';
import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatFullDate } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import { TextField } from '../../ui/primitives/TextField';
import { spacing } from '../../ui/tokens/spacing';

type BirthdatePickerProps = {
  value: DateKey | null;
  today: DateKey;
  active: boolean;
  visible: boolean;
  onChoose(value: DateKey | null): void;
  onDismiss(): void;
};

export function BirthdatePicker(props: BirthdatePickerProps): ReactElement {
  return <Sheet visible={props.visible} active={props.active} accessibilityLabel={strings.pets.birthdate}
    dismissLabel={strings.dismiss} onDismiss={props.onDismiss}>
    <BirthdateCalendar {...props} />
  </Sheet>;
}

function BirthdateCalendar({ value, today, active, onChoose }: BirthdatePickerProps): ReactElement {
  const initial = parseDateKey(value ?? today);
  const [year, setYear] = useState(String(initial.y));
  const [month, setMonth] = useState(String(initial.m));
  const y = Number(year);
  const m = Number(month);
  const valid = /^\d{1,4}$/.test(year) && /^\d{1,2}$/.test(month)
    && y >= 1 && y <= 9999 && m >= 1 && m <= 12;
  const first = valid ? weekdayOf(formatDateKey({ y, m, d: 1 })) : 0;
  return <>
    <Text variant="heading">{strings.pets.birthdate}</Text>
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <View style={{ flex: 1 }}><TextField label={strings.pets.month} accessibilityLabel={strings.pets.month}
        value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} /></View>
      <View style={{ flex: 1 }}><TextField label={strings.pets.year} accessibilityLabel={strings.pets.year}
        value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} /></View>
    </View>
    {valid && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {Object.values(strings.format.weekdays).map((day) => <View key={day} style={{ width: `${100 / 7}%` }}>
        <Text variant="caption" style={{ textAlign: 'center' }}>{day}</Text>
      </View>)}
      {Array.from({ length: first }, (_, index) => <View key={`blank-${index}`} style={{ width: `${100 / 7}%` }} />)}
      {Array.from({ length: daysInMonth(y, m) }, (_, index) => {
        const d = index + 1;
        const date = formatDateKey({ y, m, d });
        return <View key={date} style={{ width: `${100 / 7}%`, paddingVertical: spacing.xxs }}>
          <Chip label={String(d)} accessibilityLabel={formatFullDate(date)} selected={date === value}
            disabled={date > today} onPress={() => { onChoose(date); }} active={active} />
        </View>;
      })}
    </View>}
    <Button label={strings.pets.clearBirthdate} accessibilityLabel={strings.pets.clearBirthdate}
      onPress={() => { onChoose(null); }} active={active} />
  </>;
}
