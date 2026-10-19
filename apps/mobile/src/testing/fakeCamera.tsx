import { useEffect } from 'react';
import { View } from 'react-native';
import type { CameraDevice, CameraPhoto, CameraPreviewProps, Compression } from '../platform/camera';
import type { FakeFileSystem } from './fakeFileSystem';

export const fakePhoto: CameraPhoto = { uri: 'file:///fake/camera.jpg', width: 2400, height: 1800 };
export const fakePhotoHash = 'a'.repeat(64);

export function fakeCamera(fileSystem?: FakeFileSystem) {
  const takePhoto = jest.fn(async () => fakePhoto);
  const previewUnmounted = jest.fn();
  const device = {
    Preview({ onReady }: CameraPreviewProps) {
      useEffect(() => {
        onReady(takePhoto);
        return () => { onReady(null); previewUnmounted(); };
      }, [onReady]);
      return <View testID="fake-camera-preview" />;
    },
    requestPermission: jest.fn(async (): Promise<boolean> => true),
    getPermission: jest.fn(async (): Promise<boolean> => true),
    openSettings: jest.fn(async () => {}),
    pickAvatar: jest.fn<Promise<CameraPhoto | null>, []>(async () => fakePhoto),
    compress: jest.fn(async (photo: CameraPhoto, _options: Compression) => ({ ...photo, uri: 'file:///fake/compressed.jpg' })),
    writeFile: jest.fn(async (_uri: string, id: string) => {
      const uri = `file:///fake/documents/assets/${id}.jpg`;
      fileSystem?.write(uri, new Uint8Array([1, 2, 3]));
      return uri;
    }),
    sha256: jest.fn(async (_uri: string) => fakePhotoHash),
    removeFile: jest.fn(async (uri: string) => { await fileSystem?.remove(uri); }),
  } satisfies CameraDevice;
  return { device, takePhoto, previewUnmounted };
}
