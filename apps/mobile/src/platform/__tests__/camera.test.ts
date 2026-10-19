import { Camera } from 'expo-camera';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { Linking } from 'react-native';
import { createExpoCamera } from '../camera';

jest.mock('expo-camera', () => ({
  Camera: { requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
    getCameraPermissionsAsync: jest.fn(async () => ({ granted: true })) },
  CameraView: () => null,
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async () => new Uint8Array(32).fill(15).buffer),
}));
jest.mock('expo-file-system', () => ({
  Directory: jest.fn((root: string, name: string) => ({ uri: `${root}${name}`, create: jest.fn() })),
  File: jest.fn((root: string | { uri: string }, name?: string) => ({
    uri: name === undefined ? root : `${typeof root === 'string' ? root : root.uri}/${name}`,
    exists: true, move: jest.fn(), delete: jest.fn(), bytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
  })),
}));
jest.mock('expo-image-manipulator', () => {
  const image = { saveAsync: jest.fn(async () => ({ uri: 'file:///compressed.jpg', width: 1024, height: 768 })), release: jest.fn() };
  const context = { resize: jest.fn(), renderAsync: jest.fn(async () => image), release: jest.fn() };
  return { ImageManipulator: { manipulate: jest.fn(() => context) }, SaveFormat: { JPEG: 'jpeg' } };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })) }));

const device = createExpoCamera('file:///documents/');
const context = ImageManipulator.manipulate('test');

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { jest.restoreAllMocks(); });

test.each([
  [2400, 1800, { width: 1024 }], [1800, 2400, { height: 1024 }],
  [800, 600, null],
] as const)('R2.3 native compression preserves aspect ratio for %s by %s without upscaling', async (width, height, resize) => {
  await device.compress({ uri: 'file:///original.jpg', width, height }, { longestEdge: 1024, quality: 0.8 });
  expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///original.jpg');
  if (resize === null) expect(context.resize).not.toHaveBeenCalled();
  else expect(context.resize).toHaveBeenCalledWith(resize);
  const image = await jest.mocked(context.renderAsync).mock.results[0]?.value;
  expect(image?.saveAsync).toHaveBeenCalledWith({ format: SaveFormat.JPEG, compress: 0.8 });
  expect(image?.release).toHaveBeenCalledTimes(1);
  expect(context.release).toHaveBeenCalledTimes(1);
});

test('R2.3 failed rendering still releases the native image context', async () => {
  jest.mocked(context.renderAsync).mockRejectedValueOnce(new Error('Simulated render failure'));
  await expect(device.compress({ uri: 'file:///original.jpg', width: 800, height: 600 }, { longestEdge: 1024, quality: 0.8 }))
    .rejects.toThrow('Simulated render failure');
  expect(context.release).toHaveBeenCalledTimes(1);
});

test('R2.3 capture writes the JPEG in the document assets directory', async () => {
  const uri = await device.writeFile('file:///compressed.jpg', 'asset-id');
  expect(uri).toBe('file:///documents/assets/asset-id.jpg');
  expect(Directory).toHaveBeenCalledWith('file:///documents/', 'assets');
  const directory = jest.mocked(Directory).mock.results[0]?.value as Directory;
  expect(directory.create).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
  const target = jest.mocked(File).mock.results[0]?.value as File;
  const source = jest.mocked(File).mock.results[1]?.value as File;
  expect(source.move).toHaveBeenCalledWith(target);
  await device.removeFile(uri);
  const removed = jest.mocked(File).mock.results[2]?.value as File;
  expect(removed.delete).toHaveBeenCalledTimes(1);
});

test('R2.3 SHA-256 hashes raw JPEG bytes and returns lower-case hexadecimal', async () => {
  expect(await device.sha256('file:///asset.jpg')).toBe('0f'.repeat(32));
  expect(digest).toHaveBeenCalledWith(CryptoDigestAlgorithm.SHA256, new Uint8Array([1, 2, 3]));
});

test('R2.3 gallery cancellation and camera permissions use the device APIs', async () => {
  expect(await device.requestPermission()).toBe(true);
  expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await device.getPermission()).toBe(true);
  expect(Camera.getCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await device.pickAvatar()).toBeNull();
  expect(launchImageLibraryAsync).toHaveBeenCalledWith({
    mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false,
  });
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await device.openSettings();
  expect(settings).toHaveBeenCalledTimes(1);
});
