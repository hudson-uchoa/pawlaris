import { addDays, type DateKey } from '@pawlaris/shared';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatDashboardDay } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';

export interface DayHeaderProps {
  date: DateKey;
  today: DateKey;
  active: boolean;
  onChange(date: DateKey): void;
}

export function DayHeader({ date, today, active, onChange }: DayHeaderProps): ReactElement {
  const atStart = date <= addDays(today, -90);
  const atEnd = date >= addDays(today, 30);
  const previous = useCallback(() => { if (!atStart) onChange(addDays(date, -1)); }, [atStart, date, onChange]);
  const next = useCallback(() => { if (!atEnd) onChange(addDays(date, 1)); }, [atEnd, date, onChange]);
  const reset = useCallback(() => { onChange(today); }, [onChange, today]);
  const label = formatDashboardDay(date, today);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
    <PressableScale testID="day-prev" accessibilityLabel={strings.dashboard.previousDay}
      disabled={atStart} active={active} onPress={previous} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Icon glyph={ChevronLeft} color={atStart ? 'textMuted' : 'text'} />
    </PressableScale>
    {date === today ? <Text variant="heading" accessibilityRole="header">{label}</Text>
      : <PressableScale testID="day-today" accessibilityLabel={strings.dashboard.returnToday}
        active={active} onPress={reset} style={{ alignItems: 'center', justifyContent: 'center' }}><Text variant="heading">{label}</Text></PressableScale>}
    <PressableScale testID="day-next" accessibilityLabel={strings.dashboard.nextDay}
      disabled={atEnd} active={active} onPress={next} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Icon glyph={ChevronRight} color={atEnd ? 'textMuted' : 'text'} />
    </PressableScale>
  </View>;
}
