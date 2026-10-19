import { useIsFocused, useLocalSearchParams, useRouter, type RelativePathString } from 'expo-router';
import type { ReactElement } from 'react';
import { useApp } from '../src/appContext';
import { CameraScreen } from '../src/features/pets/CameraScreen';

export default function Camera(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const params = useLocalSearchParams<{ mode?: string; returnTo?: RelativePathString; returnId?: string }>();
  const mode = params.mode === 'proof' || params.mode === 'attachment' ? params.mode : 'avatar';
  return <CameraScreen mode={mode} device={app.camera} capture={app.photoCapture} active={active}
    onCancel={() => { router.back(); }} onUse={(assetId) => {
      if (params.returnTo === undefined) { router.back(); return; }
      router.dismissTo({ pathname: params.returnTo, params: { assetId,
        ...(params.returnId === undefined ? {} : { id: params.returnId }) } });
    }} />;
}
