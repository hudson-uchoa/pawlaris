import type { ReactElement } from 'react';
import type { CameraDevice } from '../../platform/camera';
import type { Clock } from '../../platform/clock';
import type { Mutations } from '../../sync/mutations';
import type { PhotoCapture } from '../pets/capture';
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

export function PhotoProofCameraScreen(_props: PhotoProofCameraScreenProps): ReactElement | null {
  return null;
}
