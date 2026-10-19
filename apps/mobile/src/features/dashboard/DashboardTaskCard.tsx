import { splitKey, type DayViewItem, type Member } from '@pawlaris/shared';
import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatFullDate, formatTime } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Card } from '../../ui/primitives/Card';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { PetAvatar } from './PetAvatar';

export interface DashboardTaskCardProps {
  item: DayViewItem;
  members: Readonly<Record<string, Member>>;
  viewerId: string;
  date: string;
  timezone: string;
}

export const DashboardTaskCard = memo(function DashboardTaskCard({ item, members, viewerId, date,
  timezone }: DashboardTaskCardProps): ReactElement {
  const time = splitKey(item.occurrenceKey).time;
  return <Card testID={`task-card-${item.taskId}-${item.occurrenceKey}`}
    accessibilityLabel={item.title} active={false} style={{ gap: spacing.xs }}>
    <Text variant="heading">{item.title}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {item.pets.map((pet) => <PetAvatar key={pet.id} pet={pet} />)}
    </View>
    <Text color="textMuted">{time ?? strings.format.allDay}</Text>
    {item.originalDate !== date && <Text color="danger">{formatFullDate(item.originalDate)}</Text>}
    {item.assignedTo === null ? <Text color="accent">{strings.tasks.anyone}</Text>
      : item.assignedTo !== viewerId && <Text color="textMuted">
        {members[item.assignedTo]?.display_name ?? strings.format.unavailable}
      </Text>}
    {item.mode === 'per_pet' && <Text variant="label">{item.progress.done}/{item.progress.total}</Text>}
    {item.completions.map((completion) => <View key={completion.id}>
      {completion.pet_id !== null && <Text variant="caption">
        {item.pets.find((pet) => pet.id === completion.pet_id)?.name ?? strings.format.unavailable}
      </Text>}
      <Text variant="caption" color="textMuted">{strings.dashboard.completedBy(
        members[completion.completed_by]?.display_name ?? strings.format.unavailable,
        formatTime(Date.parse(completion.completed_at), timezone),
      )}</Text>
    </View>)}
  </Card>;
});
