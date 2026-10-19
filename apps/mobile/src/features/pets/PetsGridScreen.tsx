import type { Pet } from '@pawlaris/shared';
import { useState, type ReactElement } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { strings } from '../../i18n/strings';
import { useReplica } from '../../replica/useReplica';
import { EmptyPets } from '../../ui/cosmos/illustrations/EmptyPets';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { illustrations } from '../../ui/tokens/cosmos';
import { spacing } from '../../ui/tokens/spacing';
import { PetCard } from './PetCard';
import type { PetScreenProps } from './types';

export type PetsGridScreenProps = PetScreenProps & {
  onAdd(): void;
  onOpenPet(id: string): void;
};

function orderPets(a: Pet, b: Pet): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

export function PetsGridScreen({ services, active, onAdd, onOpenPet }: PetsGridScreenProps): ReactElement {
  const { color } = useTheme();
  const { width } = useWindowDimensions();
  const pets = useReplica((state) => state.pets);
  const family = useReplica((state) => state.family);
  const ready = useReplica((state) => state.ready);
  const user = services.sessionUser();
  const leader = useReplica((state) => state.members[user.id]?.role === 'leader');
  const [expanded, setExpanded] = useState(false);
  const live = Object.values(pets).filter((pet) => pet.archived_at === null).sort(orderPets);
  const archived = Object.values(pets).filter((pet) => pet.archived_at !== null).sort(orderPets);
  const now = services.clock.now();
  const loading = !ready || family === null;

  return <ScrollView style={{ flex: 1, backgroundColor: color.bg }}
    contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
    {loading ? <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {[0, 1, 2, 3].map((index) => <View key={index} style={{ width: '50%', padding: spacing.xxs }}>
        <Skeleton width={Math.max(0, (width - 2 * spacing.md) / 2 - 2 * spacing.xxs)}
          height={spacing.xxl * 3} active={false} />
      </View>)}
    </View> : <>
      {live.length > 0 && <PressableScale testID="pet-add" accessibilityLabel={strings.pets.add}
        onPress={onAdd} active={active} style={{ alignSelf: 'flex-end', justifyContent: 'center' }}>
        <Text variant="label" color="accent">{strings.pets.add}</Text>
      </PressableScale>}
      {live.length === 0 ? <EmptyState title={strings.pets.emptyTitle} active={active}
        illustration={<EmptyPets width={illustrations.width} height={illustrations.height} active={active} />}
        action={{ testID: 'pet-add', label: strings.pets.addPet, accessibilityLabel: strings.pets.addPet, onPress: onAdd }} />
        : <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {live.map((pet) => <View key={pet.id} style={{ width: '50%', padding: spacing.xxs }}>
            <PetCard pet={pet} now={now} timezone={family.timezone} active={active} onPress={() => { onOpenPet(pet.id); }} />
          </View>)}
        </View>}
      {leader && archived.length > 0 && <View style={{ gap: spacing.sm }}>
        <PressableScale testID="pets-archived" accessibilityLabel={strings.pets.archived(archived.length)}
          accessibilityState={{ expanded }} onPress={() => { setExpanded(!expanded); }} active={active}>
          <Text variant="label">{strings.pets.archived(archived.length)}</Text>
        </PressableScale>
        {expanded && archived.map((pet) => <View key={pet.id} style={{ gap: spacing.xs }}>
          <PetCard pet={pet} now={now} timezone={family.timezone} active={active} onPress={() => { onOpenPet(pet.id); }} />
          <Button label={strings.pets.unarchive} accessibilityLabel={strings.pets.unarchive}
            onPress={() => { services.mutations.unarchivePet(pet.id); }} active={active} />
        </View>)}
      </View>}
    </>}
  </ScrollView>;
}
