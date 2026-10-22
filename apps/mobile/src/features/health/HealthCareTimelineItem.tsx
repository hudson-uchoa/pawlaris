import { localDate } from '@pawlaris/shared';
import Pill from 'lucide-react-native/icons/pill';
import Stethoscope from 'lucide-react-native/icons/stethoscope';
import { memo, useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatFullDate } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Card } from '../../ui/primitives/Card';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { CompletionAttribution } from '../dashboard/CompletionAttribution';
import type { PetHealthTimelineEntry } from './petHealthTimeline';

export const HealthCareTimelineItem = memo(function HealthCareTimelineItem({ entry, timezone, active, onOpen }: {
  entry: Extract<PetHealthTimelineEntry, { kind: 'care' }>;
  timezone: string;
  active: boolean;
  onOpen(id: string): void;
}): ReactElement {
  const { completion, task, member } = entry;
  const open = useCallback(() => { onOpen(task.id); }, [onOpen, task.id]);
  return <Card accessibilityLabel={completion.title_snapshot}>
    <PressableScale testID={`health-care-${completion.id}`} accessibilityLabel={completion.title_snapshot}
      active={active} onPress={open} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View accessible accessibilityRole="image" accessibilityLabel={strings.tasks.categories[task.category]}>
        <Icon glyph={task.category === 'vet' ? Stethoscope : Pill} color="accent" />
      </View>
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="label">{completion.title_snapshot}</Text>
        <Text variant="caption" color="textMuted">{formatFullDate(localDate(Date.parse(completion.completed_at), timezone))}</Text>
        <CompletionAttribution completion={completion} member={member ?? undefined} timezone={timezone} active={active} />
      </View>
    </PressableScale>
  </Card>;
});
