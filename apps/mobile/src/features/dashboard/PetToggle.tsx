import type { Completion, Member, Pet } from '@pawlaris/shared';
import { memo, useCallback, type ReactElement, type ReactNode } from 'react';
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
  width: number;
  occurrenceKey?: string;
  onPress(): void;
  onAvatarLayout?: (petId: string, layout: LayoutRectangle) => void;
  children?: ReactNode;
}

export const PetToggle = memo(function PetToggle({ pet, completion, members, timezone, active, disabled,
  testID, width, occurrenceKey, onPress, onAvatarLayout, children }: PetToggleProps): ReactElement {
  const measured = useCallback((event: LayoutChangeEvent) => {
    onAvatarLayout?.(pet.id, event.nativeEvent.layout);
  }, [pet.id, onAvatarLayout]);
  return <View onLayout={measured} style={{ width }}>
    <StarCheck checked={completion !== null} accessibilityLabel={pet.name} badge active={active}
      {...(occurrenceKey === undefined ? {} : { occurrenceKey: occurrenceKey + pet.id })}
      disabled={disabled} testID={testID} onPress={onPress}>
      <View style={{ width: spacing.xxl * 2, alignItems: 'center', gap: spacing.xs }}>
        <PetAvatar pet={pet} />
        <Text variant="label">{pet.name}</Text>
        {completion !== null && <CompletionAttribution completion={completion}
          member={members[completion.completed_by]} timezone={timezone} active={active} />}
      </View>
    </StarCheck>
    {children}
  </View>;
});
