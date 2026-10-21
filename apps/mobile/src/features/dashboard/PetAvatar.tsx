import type { Pet } from '@pawlaris/shared';
import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { AssetImage } from '../../assets/AssetImage';
import { Avatar } from '../../ui/primitives/Avatar';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';

export const PetAvatar = memo(function PetAvatar({ pet }: { pet: Pet }): ReactElement {
  const placeholder = <Avatar petId={pet.id} identityColor={pet.identity_color} species={pet.species} accessibilityLabel={pet.name} />;
  return <View style={{ width: spacing.xxl, height: spacing.xxl, borderRadius: radius.avatar, overflow: 'hidden' }}>
    {pet.avatar_asset_id === null ? placeholder
      : <AssetImage assetId={pet.avatar_asset_id} placeholder={placeholder} accessibilityLabel={pet.name} />}
  </View>;
});
