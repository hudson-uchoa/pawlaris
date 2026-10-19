import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, View, type AppStateStatus } from 'react-native';
import { AssetImage } from '../../../assets/AssetImage';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { deferred, response } from '../../../auth/__tests__/support';
import { strings } from '../../../i18n/strings';
import type { HttpResponse } from '../../../platform/http';
import { ReplicaProvider } from '../../../replica/useReplica';
import { fakeCamera, fakePhoto, fakePhotoHash } from '../../../testing/fakeCamera';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { CameraScreen } from '../CameraScreen';
import { createPhotoCapture, type CameraMode } from '../capture';
import { petContext, type PetContext } from './support';

let context: PetContext | undefined;
let receiver: PetContext | undefined;
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});
afterEach(async () => {
  await cleanup();
  context?.dispose();
  receiver?.dispose();
  context = undefined;
  receiver = undefined;
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function setup(mode: CameraMode = 'avatar') {
  const c = await petContext();
  context = c;
  const fake = fakeCamera(c.fileSystem);
  const capture = createPhotoCapture(fake.device, c.files, c.ids);
  const register = jest.spyOn(c.files, 'registerCapture');
  const onUse = jest.fn<void, [string]>();
  const onCancel = jest.fn();
  const upload = deferred<HttpResponse>();
  c.fileSystem.enqueue(() => upload.promise);
  const props = { mode, device: fake.device, capture, active: true, onUse, onCancel };
  return { ...c, ...fake, capture, register, onUse, onCancel, upload, props };
}

test.each([
  ['avatar', 1024, 0.8, 'pet_avatar'], ['proof', 1600, 0.7, 'task_proof'],
  ['attachment', 1600, 0.7, 'health_attachment'],
] as const)('R2.3 %s compresses, writes and hashes before registering once', async (mode, longestEdge, quality, kind) => {
  const c = await setup(mode);
  const hash = deferred<string>();
  c.device.sha256.mockImplementation(() => hash.promise);
  await render(<CameraScreen {...c.props} />);
  expect(c.device.requestPermission).toHaveBeenCalledTimes(1);
  if (mode !== 'avatar') expect(screen.queryByRole('button', { name: strings.camera.gallery })).toBeNull();
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  expect(c.previewUnmounted).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('camera-use'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(c.device.compress).toHaveBeenCalledTimes(1);
  expect(c.device.compress).toHaveBeenCalledWith(fakePhoto, { longestEdge, quality });
  expect(c.device.writeFile).toHaveBeenCalledTimes(1);
  const id = c.device.writeFile.mock.calls[0]?.[1];
  const uri = `file:///fake/documents/assets/${id}.jpg`;
  expect(c.device.sha256).toHaveBeenCalledWith(uri);
  expect(c.register).not.toHaveBeenCalled();
  expect(c.fileSystem.requests).toEqual([]);
  await act(async () => { hash.resolve(fakePhotoHash); });
  expect(c.register).toHaveBeenCalledTimes(1);
  expect(c.register).toHaveBeenCalledWith({ id, kind, localUri: uri, sha256: fakePhotoHash });
  expect(c.onUse).toHaveBeenCalledTimes(1);
  expect(c.onUse).toHaveBeenCalledWith(id);
  expect(c.driver.all('SELECT state, sha256 FROM asset_file')).toEqual([{ state: 'to_upload', sha256: fakePhotoHash }]);
  expect(c.fileSystem.requests[0]).toMatchObject({ method: 'PUT', uri, headers: { 'X-Content-SHA256': fakePhotoHash } });
  expect(await c.files.ensureFile(String(id))).toEqual({ status: 'ready', uri });
  expect(c.outbox.count()).toBe(0);
  await act(async () => { c.upload.resolve(response(201)); await c.files.uploads.kick(); });
  expect(c.driver.all('SELECT state FROM asset_file')).toEqual([{ state: 'uploaded' }]);
});

test('R3.46 the other phone keeps its placeholder until the uploaded asset arrives', async () => {
  const c = await setup();
  const other = await petContext();
  receiver = other;
  const id = await c.capture.save(fakePhoto, 'avatar');
  if (id === null) throw new Error('Capture was unexpectedly cancelled');
  await render(<ReplicaProvider store={other.store}><AssetFilesProvider files={other.files}>
    <AssetImage assetId={id} accessibilityLabel={strings.pets.photo} placeholder={<View testID="photo-pending" />} />
  </AssetFilesProvider></ReplicaProvider>);
  expect(screen.getByTestId('photo-pending')).toBeOnTheScreen();
  expect(other.fileSystem.requests).toEqual([]);
  await act(async () => { c.upload.resolve(response(201)); await c.files.uploads.kick(); });
  expect(screen.getByTestId('photo-pending')).toBeOnTheScreen();
  other.fileSystem.enqueue(response(200));
  await act(async () => {
    other.apply.applyServerRows([{ entity: 'assets', row: other.factory.assets({ id, kind: 'pet_avatar' }) }]);
  });
  expect(screen.queryByTestId('photo-pending')).toBeNull();
  expect(screen.getByRole('image', { name: strings.pets.photo })).toBeOnTheScreen();
  expect(other.fileSystem.requests).toHaveLength(1);
});

test('R2.3 avatar gallery works with denied camera permission and cancellation makes no write', async () => {
  const c = await setup();
  c.device.requestPermission.mockResolvedValue(false);
  c.device.pickAvatar.mockResolvedValueOnce(null);
  await render(<CameraScreen {...c.props} />);
  expect(screen.getByRole('alert')).toHaveTextContent(strings.camera.permissionDenied);
  expect(screen.getByTestId('camera-shutter')).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: strings.camera.settings }));
  expect(c.device.openSettings).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: strings.camera.gallery }));
  expect(screen.queryByTestId('camera-use')).toBeNull();
  expect(c.register).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: strings.camera.gallery }));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(c.device.pickAvatar).toHaveBeenCalledTimes(2);
  expect(c.register).toHaveBeenCalledTimes(1);
});

test('R2.3 retaking replaces the preview and only the accepted photo is registered', async () => {
  const c = await setup();
  await render(<CameraScreen {...c.props} />);
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByRole('button', { name: strings.camera.retake }));
  expect(screen.getByTestId('fake-camera-preview')).toBeOnTheScreen();
  expect(c.register).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(c.takePhoto).toHaveBeenCalledTimes(2);
  expect(c.register).toHaveBeenCalledTimes(1);
});

test.each(['cancel', 'unmount', 'blur'] as const)('R2.3 %s during preparation prevents registration and removes the unused file', async (action) => {
  const c = await setup();
  const hash = deferred<string>();
  c.device.sha256.mockImplementation(() => hash.promise);
  const view = await render(<CameraScreen {...c.props} />);
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  if (action === 'unmount') await view.unmount();
  else if (action === 'blur') await view.rerender(<CameraScreen {...c.props} active={false} />);
  else await fireEvent.press(screen.getByTestId('camera-cancel'));
  await act(async () => { hash.resolve(fakePhotoHash); });
  expect(c.register).not.toHaveBeenCalled();
  expect(c.onUse).not.toHaveBeenCalled();
  expect(c.device.removeFile).toHaveBeenCalledTimes(1);
  expect(c.driver.all('SELECT * FROM asset_file')).toEqual([]);
});

test('R2.3 failed preparation keeps the photo available for retry', async () => {
  const c = await setup();
  c.device.sha256.mockRejectedValueOnce(new Error('Simulated hash failure'));
  await render(<CameraScreen {...c.props} />);
  await fireEvent.press(screen.getByTestId('camera-shutter'));
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(screen.getByRole('alert')).toHaveTextContent(strings.camera.error);
  expect(c.register).not.toHaveBeenCalled();
  expect(c.device.removeFile).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('camera-use'));
  expect(c.register).toHaveBeenCalledTimes(1);
});

test('R2.3 preview is unmounted off screen and permissions refresh after Settings', async () => {
  const c = await setup();
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  const view = await render(<CameraScreen {...c.props} />);
  await view.rerender(<CameraScreen {...c.props} active={false} />);
  expect(screen.queryByTestId('fake-camera-preview')).toBeNull();
  await view.rerender(<CameraScreen {...c.props} />);
  await act(() => { for (const listener of listeners) listener('active'); });
  expect(c.device.requestPermission.mock.calls.length).toBeGreaterThan(1);
  expect(c.device.getPermission).toHaveBeenCalled();
});
