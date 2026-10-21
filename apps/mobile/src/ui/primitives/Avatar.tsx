import { identityIndexForId, identityIndexForKey } from '@pawlaris/shared';
import { Cat, Dog } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '../theme';
import { identity } from '../tokens/color';
import { icon } from '../tokens/icon';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';

export type AvatarProps = {
  petId: string;
  identityColor?: string | null;
  species: 'cat' | 'dog';
  accessibilityLabel: string;
  uri?: string | null;
  size?: number;
  testID?: string;
};

export function Avatar({ petId, identityColor = null, species, accessibilityLabel, uri, size = spacing.xxl, testID }: AvatarProps): ReactElement {
  const { scheme, color } = useTheme();
  const index = identityColor === null ? identityIndexForId(petId) : identityIndexForKey(identityColor);
  const entry = identity[index] ?? identity[0];
  const Glyph = species === 'cat' ? Cat : Dog;
  return <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}
    testID={testID} style={{ width: size, height: size, borderRadius: radius.avatar,
      overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: entry[scheme] }}>
    {uri ? <Image source={{ uri }} accessible={false} style={{ width: size, height: size }} />
      : <Glyph size={icon.large} strokeWidth={icon.strokeWidth} color={color.onAccent} accessible={false} aria-hidden />}
  </View>;
}
