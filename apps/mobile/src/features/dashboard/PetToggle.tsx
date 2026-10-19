import type { Completion, Member, Pet } from '@pawlaris/shared';
import { memo, useCallback, type ReactElement } from 'react';
import { View, type LayoutChangeEvent, type LayoutRectangle } from 'react-native';
import { StarCheck } from '../../ui/cosmos/StarCheck';
import { Text } from '../../ui/primitives/Text';
import { spacing } from '../../ui/tokens/spacing';
import { CompletionAttribution } from './CompletionAttribution';
import { PetAvatar } from './PetAvatar';

export interface PetToggleProps {
  pet: Pet;
  completion: Completion | null;
  members: Readonly<Record<string, Member>>;
  timezone: string;
  active: boolean;
  disabled: boolean;
  testID: string;
  onPress(): void;
  onAvatarLayout?: (petId: string, layout: LayoutRectangle) => void;
}

export const PetToggle = memo(function PetToggle({ pet, completion, members, timezone, active, disabled,
  testID, onPress, onAvatarLayout }: PetToggleProps): ReactElement {
  const measured = useCallback((event: LayoutChangeEvent) => {
    onAvatarLayout?.(pet.id, event.nativeEvent.layout);
  }, [pet.id, onAvatarLayout]);
  return <View onLayout={measured}>
    <StarCheck checked={completion !== null} accessibilityLabel={pet.name} badge active={active}
      disabled={disabled} testID={testID} onPress={onPress}>
      <View style={{ width: spacing.xxl * 2, alignItems: 'center', gap: spacing.xs }}>
        <PetAvatar pet={pet} />
        <Text variant="label">{pet.name}</Text>
        {completion !== null && <CompletionAttribution completion={completion}
          member={members[completion.completed_by]} timezone={timezone} active={active} />}
      </View>
    </StarCheck>
  </View>;
});
