import { useCallback, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatMonth } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { Button } from '../../ui/primitives/Button';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { HealthCareTimelineItem } from './HealthCareTimelineItem';
import { HealthTimelineItem } from './HealthTimelineItem';
import { selectPetHealthTimeline } from './petHealthTimeline';

export type HealthTimelineSectionProps = {
  petId: string;
  active: boolean;
  onAdd(): void;
  onOpen(id: string): void;
  onOpenTask?: ((id: string) => void) | undefined;
  onSchedule?: (() => void) | undefined;
};

export function HealthTimelineSection({ petId, active, onAdd, onOpen, onOpenTask, onSchedule }: HealthTimelineSectionProps): ReactElement {
  const state = useReplica((snapshot) => snapshot);
  const family = state.family;
  const months = useMemo(() => selectPetHealthTimeline(state, petId), [state, petId]);
  const openTask = useCallback((id: string) => { onOpenTask?.(id); }, [onOpenTask]);
  if (family === null) return <Skeleton width={spacing.xxl * 4} height={spacing.xxl * 2} active={active} />;
  return <View testID="pet-health" style={{ gap: spacing.sm }}>
    <Text variant="heading" accessibilityRole="header">{strings.health.heading}</Text>
    {months.map(({ month, entries }) => <View key={month} testID={`health-month-${month}`} style={{ gap: spacing.sm }}>
      <Text variant="label" accessibilityRole="header">{formatMonth(month)}</Text>
      {entries.map((entry) => entry.kind === 'event'
        ? <HealthTimelineItem key={`event:${entry.event.id}`} event={entry.event}
          timezone={family.timezone} active={active} onOpen={onOpen} />
        : <HealthCareTimelineItem key={`care:${entry.completion.id}`} entry={entry}
          timezone={family.timezone} active={active} onOpen={openTask} />)}
    </View>)}
    <Button testID="health-add" label={strings.health.add} accessibilityLabel={strings.health.add}
      active={active} onPress={onAdd} />
    <Button testID="health-schedule" label={strings.health.scheduleTreatment} accessibilityLabel={strings.health.scheduleTreatment}
      active={active} onPress={() => { onSchedule?.(); }} />
  </View>;
}
