import type { Pet } from '@pawlaris/shared';
import { localDate } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AssetImage } from '../../assets/AssetImage';
import { formatPetAge, formatPetListValue } from '../../i18n/format';
import { Orbit } from '../../ui/cosmos/Orbit';
import { useHeroSource } from '../../ui/motion/hero';
import { Avatar } from '../../ui/primitives/Avatar';
import { Card } from '../../ui/primitives/Card';
import { Text } from '../../ui/primitives/Text';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';

export type PetCardProps = {
  pet: Pet;
  now: number;
  timezone: string;
  active: boolean;
  onPress(): void;
};

export function PetCard({ pet, now, timezone, active, onPress }: PetCardProps): ReactElement {
  const hero = useHeroSource(pet.id);
  const age = pet.birthdate === null ? null : formatPetAge(pet.birthdate, localDate(now, timezone));
  const placeholder = <Avatar petId={pet.id} identityColor={pet.identity_color} species={pet.species} accessibilityLabel={pet.name} size={spacing.xxl} />;
  const avatar = <View style={{ width: spacing.xxl, height: spacing.xxl, borderRadius: radius.avatar, overflow: 'hidden' }}>
    {pet.avatar_asset_id === null ? placeholder
      : <AssetImage assetId={pet.avatar_asset_id} placeholder={placeholder} accessibilityLabel={pet.name} />}
  </View>;
  const name = <Text variant="label" style={{ textAlign: 'center' }}>{pet.name}</Text>;
  return <Animated.View style={[{ flex: 1 }, hero.contentStyle]}>
    <Card testID={`pet-card-${pet.id}`} accessibilityLabel={age === null ? pet.name : `${pet.name}, ${age}`}
    active={active} onPress={() => { hero.start({ avatar, name }, onPress); }}
    style={{ alignItems: 'center', gap: spacing.xs, flex: 1 }}>
    <Orbit petId={pet.id} identityColor={pet.identity_color} size={spacing.xxl + spacing.md} active={active} testID={`pet-orbit-${pet.id}`}>
      <Animated.View {...hero.avatar} testID={`pet-source-avatar-${pet.id}`}>{avatar}</Animated.View>
    </Orbit>
    <Animated.View {...hero.name} testID={`pet-source-name-${pet.id}`}>{name}</Animated.View>
    {pet.breed && <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
      {formatPetListValue(pet.species, 'breed', pet.breed)}
    </Text>}
    {pet.color && <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
      {formatPetListValue(pet.species, 'coat', pet.color)}
    </Text>}
    {age !== null && <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>{age}</Text>}
  </Card></Animated.View>;
}
