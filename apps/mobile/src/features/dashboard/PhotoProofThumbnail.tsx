import { Image } from 'expo-image';
import { Image as ImageGlyph } from 'lucide-react-native';
import { useCallback, useContext, useSyncExternalStore, type ReactElement } from 'react';
import { View } from 'react-native';
import { AssetFilesContext, useAssetFile } from '../../assets/useAssetFile';
import { strings } from '../../i18n/strings';
import { Icon } from '../../ui/primitives/Icon';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { Text } from '../../ui/primitives/Text';
import { useTheme } from '../../ui/theme';
import { radius } from '../../ui/tokens/radius';
import { spacing } from '../../ui/tokens/spacing';

export function PhotoProofThumbnail({ assetId, active, onOpen }: {
  assetId: string; active: boolean; onOpen?: (assetId: string) => void;
}): ReactElement {
  const files = useContext(AssetFilesContext);
  if (files === null) throw new Error('PhotoProofThumbnail requires an AssetFilesProvider');
  const subscribe = useCallback((listener: () => void) => active
    ? files.subscribeUploadState(listener) : () => {}, [files, active]);
  const snapshot = useCallback(() => files.uploadState(assetId), [files, assetId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const file = useAssetFile(assetId);
  const { color } = useTheme();
  const label = state === 'to_upload' ? strings.health.photoUploading
    : state === 'failed' ? strings.health.photoFailed : file.status !== 'ready' ? strings.health.photoPending : null;
  return <View style={{ gap: spacing.xxs, alignItems: 'flex-end', maxWidth: spacing.xxl * 3 }}>
    <PressableScale accessibilityLabel={strings.pets.photo} active={active}
      onPress={() => { onOpen?.(assetId); }}
      style={{ width: spacing.xxl + spacing.md, height: spacing.xxl + spacing.md,
        borderRadius: radius.chip, backgroundColor: color.surfaceSunken, overflow: 'hidden',
        alignItems: 'center', justifyContent: 'center' }}>
      {file.status === 'ready' ? <Image source={{ uri: file.uri }} accessible accessibilityRole="image"
        accessibilityLabel={strings.pets.photo} contentFit="cover" transition={0} recyclingKey={assetId}
        style={{ width: '100%', height: '100%' }} /> : <Icon glyph={ImageGlyph} color="textMuted" />}
    </PressableScale>
    {state === 'failed' ? <PressableScale testID="photo-retry" accessibilityLabel={strings.health.photoFailed} active={active}
      onPress={() => { files.retryUpload(assetId); }} style={{ justifyContent: 'center' }}>
      <Text variant="caption" color="danger">{strings.health.photoFailed}</Text>
    </PressableScale> : label !== null && <Text variant="caption" color="textMuted">{label}</Text>}
  </View>;
}
