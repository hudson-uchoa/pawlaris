import { localDate } from '@pawlaris/shared';
import { useState, type ReactElement } from 'react';
import { FlatList, View } from 'react-native';
import { formatFullDate, formatWalkSummary } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { useAnimationActive } from '../../ui/motion/useAnimationActive';
import { Button } from '../../ui/primitives/Button';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Sheet } from '../../ui/primitives/Sheet';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';
import { useNow } from '../dashboard/useNow';
import type { LocationState } from '../../walks/permissions';
import { PermissionGate } from './PermissionGate';
import { RouteThumbnail } from './RouteThumbnail';
import type { WalkScreenServices } from './types';

export interface WalksScreenProps {
  services: WalkScreenServices;
  active: boolean;
  locationState: LocationState;
  onStart(petId: string): void;
  onResume(): void;
  onOpenWalk(walkId: string): void;
  onRequestLocation(): void;
  onOpenSettings(): void;
}

export function WalksScreen({ services, active: focused, locationState, onStart, onResume,
  onOpenWalk, onRequestLocation, onOpenSettings }: WalksScreenProps): ReactElement {
  const { color } = useTheme();
  const active = useAnimationActive(focused);
  useNow(services.clock, 60_000, active);
  const now = services.clock.now();
  const pets = useReplica((state) => state.pets);
  const walks = useReplica((state) => state.walks);
  const members = useReplica((state) => state.members);
  const timezone = useReplica((state) => state.family?.timezone ?? 'UTC');
  const dogs = Object.values(pets).filter((pet) => pet.species === 'dog' && pet.archived_at === null);
  const local = services.readLocalWalk();
  const resumable = local?.state === 'active' || local?.state === 'paused';
  const user = services.sessionUser();
  const leader = user !== null && members[user.id]?.role === 'leader';
  const [picker, setPicker] = useState(false);
  const [failed, setFailed] = useState(false);
  const history = Object.values(walks).filter((walk) => walk.deleted_at === null
    && (walk.status === 'finished' || (walk.status === 'active' && walk.user_id !== user?.id
      && now - Date.parse(walk.started_at) > 12 * 3_600_000)))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  return <View style={{ flex: 1, backgroundColor: color.bg }}>
    <FlatList testID="walk-history" data={history} keyExtractor={(walk) => walk.id}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
      ListHeaderComponent={<View style={{ gap: spacing.md }}>
        {resumable ? <Button testID="walk-resume" label={strings.walks.resumeWalk}
          accessibilityLabel={strings.walks.resumeWalk} active={active} disabled={!active} onPress={onResume} />
          : dogs.length === 0 ? <Text>{strings.walks.noDogs}</Text>
            : <Button testID="walk-start" label={dogs.length === 1 && dogs[0] !== undefined
              ? strings.walks.startWithDog(dogs[0].name) : strings.walks.start}
            accessibilityLabel={strings.walks.start} active={active} disabled={!active || locationState !== 'granted'}
            onPress={() => {
              const dog = dogs[0];
              if (dogs.length === 1 && dog !== undefined) onStart(dog.id);
              else setPicker(true);
            }} />}
        <PermissionGate state={locationState} active={active} onRequest={onRequestLocation}
          onOpenSettings={onOpenSettings}>{null}</PermissionGate>
        {failed && <Text accessibilityRole="alert">{strings.settings.operationFailed}</Text>}
      </View>}
      renderItem={({ item: walk }) => <View testID={`walk-row-${walk.id}`}
        style={{ backgroundColor: color.surface, borderRadius: spacing.md, padding: spacing.md, gap: spacing.sm }}>
        {walk.status === 'finished' ? <PressableScale active={active} disabled={!active}
          accessibilityLabel={formatFullDate(localDate(Date.parse(walk.started_at), timezone))}
          onPress={() => { onOpenWalk(walk.id); }}>
          <RouteThumbnail preview={walk.preview} width={120} height={80} />
          <Text>{formatFullDate(localDate(Date.parse(walk.started_at), timezone))}</Text>
          <Text>{formatWalkSummary(walk)}</Text>
          <Text color="textMuted">{members[walk.user_id]?.display_name}</Text>
        </PressableScale> : <>
          <Text>{strings.walks.interrupted}</Text>
          <Text color="textMuted">{members[walk.user_id]?.display_name}</Text>
          {leader && <Button label={strings.walks.discard} accessibilityLabel={strings.walks.discard}
            active={active} disabled={!active} onPress={() => {
              try { services.mutations.discardWalk(walk.id); } catch { setFailed(true); }
            }} />}
        </>}
      </View>} />
    <Sheet testID="walk-dog-picker" visible={picker} active={active}
      accessibilityLabel={strings.walks.start} dismissLabel={strings.dashboard.cancel}
      onDismiss={() => { setPicker(false); }}>
      {dogs.map((dog) => <Button key={dog.id} label={dog.name} accessibilityLabel={dog.name}
        active={active} disabled={!active || locationState !== 'granted'} onPress={() => {
          setPicker(false); onStart(dog.id);
        }} />)}
    </Sheet>
  </View>;
}
