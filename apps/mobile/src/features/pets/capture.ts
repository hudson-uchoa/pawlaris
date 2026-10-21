import type { Asset } from '@pawlaris/shared';
import type { AssetFiles } from '../../assets/files';
import type { CameraDevice, CameraPhoto, Compression } from '../../platform/camera';
import type { IdGen } from '../../platform/idGen';

export type CameraMode = 'avatar' | 'proof' | 'attachment';
const modes: Record<CameraMode, Compression & { kind: Asset['kind'] }> = {
  avatar: { longestEdge: 1024, quality: 0.8, kind: 'pet_avatar' },
  proof: { longestEdge: 1600, quality: 0.7, kind: 'task_proof' },
  attachment: { longestEdge: 1600, quality: 0.7, kind: 'health_attachment' },
};

export interface PhotoCapture {
  save(photo: CameraPhoto, mode: CameraMode, canRegister?: () => boolean,
    onRegistered?: (id: string) => void): Promise<string | null>;
}

export function createPhotoCapture(device: CameraDevice, files: AssetFiles, ids: IdGen): PhotoCapture {
  return {
    async save(photo, mode, canRegister = () => true, onRegistered) {
      const id = ids.uuid();
      const { kind, longestEdge, quality } = modes[mode];
      const compressed = await device.compress(photo, { longestEdge, quality });
      const uri = await device.writeFile(compressed.uri, id);
      let registered = false;
      try {
        const sha256 = await device.sha256(uri);
        if (!canRegister()) return null;
        files.registerCapture({ id, kind, localUri: uri, sha256 });
        registered = true;
        // Commit the referencing mutation before the upload loop can run.
        onRegistered?.(id);
        return id;
      } finally {
        if (!registered) await device.removeFile(uri);
      }
    },
  };
}
