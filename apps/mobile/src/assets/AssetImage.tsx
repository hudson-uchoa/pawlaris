import { Image, type ImageProps } from 'expo-image';
import type { ReactElement, ReactNode } from 'react';
import { useAssetFile } from './useAssetFile';

export type AssetImageProps = {
  assetId: string;
  placeholder: ReactNode;
  accessibilityLabel: string;
  testID?: string;
  style?: ImageProps['style'];
};

export function AssetImage({ assetId, placeholder, accessibilityLabel, testID, style }: AssetImageProps): ReactElement {
  const file = useAssetFile(assetId);
  if (file.status !== 'ready') return <>{placeholder}</>;
  return <Image source={{ uri: file.uri }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}
    testID={testID} contentFit="cover" transition={0} recyclingKey={assetId}
    style={[{ width: '100%', height: '100%' }, style]} />;
}
