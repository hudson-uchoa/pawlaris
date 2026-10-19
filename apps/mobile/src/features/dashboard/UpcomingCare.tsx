import type { Pet, UpcomingCareItem } from '@pawlaris/shared';
import { memo, useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatCareDue } from '../../i18n/format';
import { strings } from '../../i18n/strings';
import { Card } from '../../ui/primitives/Card';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { PetAvatar } from './PetAvatar';

export function UpcomingCare({ items, pets, onOpenPet }: {
  items: readonly UpcomingCareItem[];
  pets: Readonly<Record<string, Pet>>;
  onOpenPet(id: string): void;
}): ReactElement | null {
  if (items.length === 0) return null;
  return <View testID="section-care" style={{ gap: spacing.sm }}>
    <Text variant="heading" accessibilityRole="header">{strings.dashboard.upcomingCare}</Text>
    {items.map((item) => {
      const pet = pets[item.pet_id];
      return pet === undefined ? null : <CareRow key={item.id} item={item} pet={pet} onOpenPet={onOpenPet} />;
    })}
  </View>;
}

const CareRow = memo(function CareRow({ item, pet, onOpenPet }: {
  item: UpcomingCareItem;
  pet: Pet;
  onOpenPet(id: string): void;
}): ReactElement {
  const open = useCallback(() => { onOpenPet(pet.id); }, [onOpenPet, pet.id]);
  return <Card testID={`care-event-${item.id}`} accessibilityLabel={`${pet.name}, ${item.title}`}
    active={false} onPress={open} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
    <PetAvatar pet={pet} />
    <View style={{ flex: 1, gap: spacing.xxs }}>
      <Text variant="label">{item.title}</Text>
      <Text variant="caption" color={item.daysUntil < 0 ? 'danger' : 'textMuted'}>{formatCareDue(item.daysUntil)}</Text>
    </View>
  </Card>;
});
