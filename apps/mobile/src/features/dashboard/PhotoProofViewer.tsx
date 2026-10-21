import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAssetFile } from '../../assets/useAssetFile';
import { strings } from '../../i18n/strings';
import { Button } from '../../ui/primitives/Button';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { spacing } from '../../ui/tokens/spacing';

export interface PhotoProofViewerProps {
  assetId: string;
  active: boolean;
  onClose(): void;
}

export function PhotoProofViewer({ assetId, active, onClose }: PhotoProofViewerProps): ReactElement {
  const { color } = useTheme();
  const file = useAssetFile(assetId);
  return <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }}>
    {file.status === 'ready' ? <Image source={{ uri: file.uri }} accessible accessibilityRole="image"
      accessibilityLabel={strings.pets.photo} contentFit="contain" transition={0} recyclingKey={assetId}
      style={{ flex: 1 }} />
      : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text color="textMuted">{strings.health.photoPending}</Text>
      </View>}
    <View style={{ padding: spacing.md }}>
      <Button label={strings.dismiss} accessibilityLabel={strings.dismiss} active={active} onPress={onClose} />
    </View>
  </SafeAreaView>;
}
