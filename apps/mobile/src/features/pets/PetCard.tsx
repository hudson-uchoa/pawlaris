import type { Pet } from '@pawlaris/shared';
import { localDate } from '@pawlaris/shared';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { AssetImage } from '../../assets/AssetImage';
import { formatPetAge } from '../../i18n/format';
import { Orbit } from '../../ui/cosmos/Orbit';
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
  const age = pet.birthdate === null ? null : formatPetAge(pet.birthdate, localDate(now, timezone));
  const placeholder = <Avatar petId={pet.id} species={pet.species} accessibilityLabel={pet.name} size={spacing.xxl} />;
  return <Card testID={`pet-card-${pet.id}`} accessibilityLabel={age === null ? pet.name : `${pet.name}, ${age}`}
    active={active} onPress={onPress} style={{ alignItems: 'center', gap: spacing.xs, flex: 1 }}>
    <Orbit petId={pet.id} size={spacing.xxl + spacing.md} active={active} testID={`pet-orbit-${pet.id}`}>
      <View style={{ width: spacing.xxl, height: spacing.xxl, borderRadius: radius.avatar, overflow: 'hidden' }}>
        {pet.avatar_asset_id === null ? placeholder
          : <AssetImage assetId={pet.avatar_asset_id} placeholder={placeholder} accessibilityLabel={pet.name} />}
      </View>
    </Orbit>
    <Text variant="label" style={{ textAlign: 'center' }}>{pet.name}</Text>
    {age !== null && <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>{age}</Text>}
  </Card>;
}
