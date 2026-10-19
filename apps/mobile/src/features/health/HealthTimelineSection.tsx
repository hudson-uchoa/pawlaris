import { useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatMonth } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { Button } from '../../ui/primitives/Button';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { groupHealthEventsByMonth } from './groupHealthEventsByMonth';
import { HealthTimelineItem } from './HealthTimelineItem';

export type HealthTimelineSectionProps = {
  petId: string;
  active: boolean;
  onAdd(): void;
  onOpen(id: string): void;
};

export function HealthTimelineSection({ petId, active, onAdd, onOpen }: HealthTimelineSectionProps): ReactElement {
  const family = useReplica((state) => state.family);
  const events = useReplica((state) => state.healthEvents);
  const months = useMemo(() => family === null ? [] : groupHealthEventsByMonth(
    Object.values(events).filter((event) => event.pet_id === petId && event.deleted_at === null),
    family.timezone,
  ), [events, family, petId]);
  if (family === null) return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 2} active={active} />;
  return <View testID="pet-health" style={{ gap: spacing.sm }}>
    <Text variant="heading" accessibilityRole="header">{strings.health.heading}</Text>
    {months.map(({ month, events: entries }) => <View key={month} testID={`health-month-${month}`} style={{ gap: spacing.sm }}>
      <Text variant="label" accessibilityRole="header">{formatMonth(month)}</Text>
      {entries.map((event) => <HealthTimelineItem key={event.id} event={event}
        timezone={family.timezone} active={active} onOpen={onOpen} />)}
    </View>)}
    <Button testID="health-add" label={strings.health.add} accessibilityLabel={strings.health.add}
      active={active} onPress={onAdd} />
  </View>;
}
