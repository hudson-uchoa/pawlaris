import { Camera, CameraView } from 'expo-camera';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { useEffect, useRef, type ComponentType, type ReactElement } from 'react';
import { Linking, StyleSheet } from 'react-native';

export type CameraPhoto = { uri: string; width: number; height: number };
export type Compression = { longestEdge: number; quality: number };
export type CameraPreviewProps = {
  onReady(capture: (() => Promise<CameraPhoto>) | null): void;
  onError(): void;
};

export interface CameraDevice {
  Preview: ComponentType<CameraPreviewProps>;
  requestPermission(): Promise<boolean>;
  getPermission(): Promise<boolean>;
  openSettings(): Promise<void>;
  pickAvatar(): Promise<CameraPhoto | null>;
  compress(photo: CameraPhoto, options: Compression): Promise<CameraPhoto>;
  writeFile(uri: string, id: string): Promise<string>;
  sha256(uri: string): Promise<string>;
  removeFile(uri: string): Promise<void>;
}

function Preview({ onReady, onError }: CameraPreviewProps): ReactElement {
  const camera = useRef<CameraView | null>(null);
  useEffect(() => () => { onReady(null); }, [onReady]);
  return <CameraView ref={camera} facing="back" mode="picture" mute style={StyleSheet.absoluteFill}
    onMountError={onError} onCameraReady={() => {
      onReady(async () => {
        if (camera.current === null) throw new Error('Camera preview is unavailable');
        return camera.current.takePictureAsync({ quality: 1, exif: false });
      });
    }} />;
}

export function createExpoCamera(documentDirectory: string): CameraDevice {
  return {
    Preview,
    async requestPermission() { return (await Camera.requestCameraPermissionsAsync()).granted; },
    async getPermission() { return (await Camera.getCameraPermissionsAsync()).granted; },
    openSettings: () => Linking.openSettings(),
    async pickAvatar() {
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false });
      return result.canceled ? null : result.assets[0] ?? null;
    },
    async compress(photo, { longestEdge, quality }) {
      const context = ImageManipulator.manipulate(photo.uri);
      if (Math.max(photo.width, photo.height) > longestEdge) {
        context.resize(photo.width >= photo.height ? { width: longestEdge } : { height: longestEdge });
      }
      try {
        const image = await context.renderAsync();
        try { return await image.saveAsync({ format: SaveFormat.JPEG, compress: quality }); }
        finally { image.release(); }
      } finally { context.release(); }
    },
    async writeFile(uri, id) {
      const directory = new Directory(documentDirectory, 'assets');
      directory.create({ intermediates: true, idempotent: true });
      const target = new File(directory, `${id}.jpg`);
      new File(uri).move(target);
      return target.uri;
    },
    async sha256(uri) {
      const bytes = await new File(uri).bytes();
      const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    async removeFile(uri) { const file = new File(uri); if (file.exists) file.delete(); },
  };
}
