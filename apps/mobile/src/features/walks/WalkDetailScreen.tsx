import { useState, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { formatDateTime, formatDistance, formatDuration, formatPace } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { Button } from '../../ui/primitives/Button';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { useWalkRoute } from '../../walks/useWalkRoute';
import { WalkMap } from './WalkMap';
import type { WalkScreenServices } from './types';

export interface WalkDetailScreenProps {
  walkId: string;
  services: WalkScreenServices;
  active: boolean;
  onDiscarded(): void;
}

function DetailRoute({ id, active }: { id: string; active: boolean }): ReactElement {
  const route = useWalkRoute(id);
  if (route.status === 'pending') return <View testID="walk-route-loading">
    <Skeleton width={spacing.xxl * 5} height={spacing.xxl * 5} active={active} />
  </View>;
  if (route.status === 'unavailable') return <View style={{ padding: spacing.md, minHeight: spacing.xxl * 5 }}>
    <Text>{strings.walks.routeUnavailable}</Text>
  </View>;
  return <WalkMap points={route.points} mode="detail" active={active} />;
}

export function WalkDetailScreen({ walkId, services, active: focused, onDiscarded }: WalkDetailScreenProps): ReactElement {
  const { color } = useTheme();
  const active = useAnimationActive(focused);
  const walk = useReplica((state) => state.walks[walkId]);
  const members = useReplica((state) => state.members);
  const timezone = useReplica((state) => state.family?.timezone ?? 'UTC');
  const user = services.sessionUser();
  const [failed, setFailed] = useState(false);
  if (walk === undefined || walk.deleted_at !== null || walk.status === 'discarded') {
    return <View style={{ flex: 1, backgroundColor: color.bg }} />;
  }
  const canDiscard = user !== null && (user.id === walk.user_id || members[user.id]?.role === 'leader');
  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
    {walk.has_route ? <DetailRoute key={walk.id} id={walk.id} active={active} />
      : <WalkMap points={[]} mode="detail" active={active} />}
    <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
      <Text variant="display">{formatDistance(walk.distance_m)}</Text>
      <Text>{formatDuration(walk.duration_s)}</Text>
      <Text>{formatPace(walk.avg_pace_s_per_km)}</Text>
      <Text>{formatDateTime(Date.parse(walk.started_at), timezone)}</Text>
      {walk.ended_at !== null && <Text>{formatDateTime(Date.parse(walk.ended_at), timezone)}</Text>}
      <Text>{members[walk.user_id]?.display_name}</Text>
      {walk.note !== null && <Text>{walk.note}</Text>}
      {canDiscard && <Button testID="walk-discard" label={strings.walks.discard}
        accessibilityLabel={strings.walks.discard} active={active} disabled={!active}
        onPress={() => {
          try { services.mutations.discardWalk(walk.id); onDiscarded(); } catch { setFailed(true); }
        }} />}
      {failed && <Text accessibilityRole="alert">{strings.settings.operationFailed}</Text>}
    </View>
  </ScrollView>;
}
