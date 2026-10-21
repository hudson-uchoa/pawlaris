import type { ReactElement } from 'react';
import type { CameraDevice } from '../../platform/camera';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';
import type { PhotoCapture } from '../pets/capture';
import { CameraScreen } from '../pets/CameraScreen';
import type { PhotoProofTarget } from './types';

export interface PhotoProofCameraScreenProps {
  target: PhotoProofTarget;
  device: CameraDevice;
  capture: PhotoCapture;
  clock: Clock;
  mutations: Pick<Mutations, 'createCompletion'>;
  active: boolean;
  onClose(): void;
}

export function PhotoProofCameraScreen({ target, device, capture, clock, mutations, active,
  onClose }: PhotoProofCameraScreenProps): ReactElement {
  return <CameraScreen mode="proof" device={device} capture={capture} active={active}
    onCancel={onClose} onUse={(assetId) => {
      mutations.createCompletion({ task_id: target.taskId, occurrence_key: target.occurrenceKey,
        pet_id: target.petId, completed_at: new Date(clock.now()).toISOString(), photo_asset_id: assetId, note: null });
      onClose();
    }} />;
}
