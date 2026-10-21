import { useIsFocused, useLocalSearchParams, useRouter, type RelativePathString } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useApp } from '../src/appContext';
import { PhotoProofCameraScreen } from '../src/features/dashboard/PhotoProofCameraScreen';
import { CameraScreen } from '../src/features/pets/CameraScreen';

export default function Camera(): ReactElement {
  const app = useApp();
  const router = useRouter();
  const active = useIsFocused();
  const params = useLocalSearchParams<{ mode?: string; returnTo?: RelativePathString; returnId?: string;
    taskId?: string; occurrenceKey?: string; petId?: string }>();
  const mode = params.mode === 'proof' || params.mode === 'attachment' ? params.mode : 'avatar';
  if (mode === 'proof') {
    if (params.taskId === undefined || params.occurrenceKey === undefined) return <View />;
    return <PhotoProofCameraScreen target={{ taskId: params.taskId, occurrenceKey: params.occurrenceKey,
      petId: params.petId ?? null }} device={app.camera} capture={app.photoCapture} clock={app.clock}
      mutations={app.mutations} active={active} onClose={() => { router.back(); }} />;
  }
  return <CameraScreen mode={mode} device={app.camera} capture={app.photoCapture} active={active}
    onCancel={() => { router.back(); }} onUse={(assetId) => {
      if (params.returnTo === undefined) { router.back(); return; }
      router.dismissTo({ pathname: params.returnTo, params: { assetId,
        ...(params.returnId === undefined ? {} : { id: params.returnId }) } });
    }} />;
}
