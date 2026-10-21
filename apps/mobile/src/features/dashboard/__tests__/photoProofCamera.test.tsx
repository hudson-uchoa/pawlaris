import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { deferred, response } from '../../../auth/__tests__/support';
import type { HttpResponse } from '../../../platform/http';
import { fakePhoto, fakePhotoHash } from '../../../testing/fakeCamera';
import { PhotoProofCameraScreen } from '../PhotoProofCameraScreen';
import {
  paintPhotoCard, photoProofContext, photoProofLifecycle, PhotoProofProviders,
  type PhotoProofContext,
} from './photoProofSupport';

jest.mock('react-native/Libraries/Utilities/useColorScheme');
photoProofLifecycle();

function cameraTree(c: PhotoProofContext) {
  return <PhotoProofProviders c={c}><PhotoProofCameraScreen target={c.target}
    device={c.device} capture={c.capture} clock={c.clock} mutations={c.mutations}
    active onClose={c.onClose} /></PhotoProofProviders>;
}

describe('TaskCard — photo proof', () => {
  test.each(['together', 'per_pet'] as const)(
    'R3.44 opens the camera for the %s occurrence instead of completing', async (mode) => {
      const c = await photoProofContext(mode);
      await paintPhotoCard(c);
      await fireEvent(screen.getByTestId(c.checkId), 'pressIn');
      expect(c.onPhotoRequired).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId(c.checkId));
      expect(c.onPhotoRequired).toHaveBeenCalledTimes(1);
      expect(c.onPhotoRequired).toHaveBeenCalledWith(c.target);
      expect(Object.values(c.store.getState().completions)).toEqual([]);
      expect(c.outbox.count()).toBe(0);
      expect(c.fileSystem.requests).toEqual([]);
      expect(screen.getByTestId(c.checkId)).not.toBeChecked();
    },
  );
});

describe('Photo proof camera', () => {
  test.each(['before capture', 'after capture'] as const)(
    'R3.44 cancelling %s completes nothing and registers no file', async (stage) => {
      const c = await photoProofContext();
      await render(cameraTree(c));
      if (stage === 'after capture') {
        await fireEvent.press(screen.getByTestId('camera-shutter'));
        expect(screen.getByTestId('camera-use')).toBeOnTheScreen();
        expect(c.takePhoto).toHaveBeenCalledTimes(1);
      }
      expect(c.driver.all('SELECT * FROM asset_file')).toEqual([]);
      expect(c.outbox.count()).toBe(0);
      await fireEvent.press(screen.getByTestId('camera-cancel'));
      expect(c.onClose).toHaveBeenCalledTimes(1);
      expect(c.device.compress).not.toHaveBeenCalled();
      expect(c.device.writeFile).not.toHaveBeenCalled();
      expect(c.driver.all('SELECT * FROM asset_file')).toEqual([]);
      expect(Object.values(c.store.getState().completions)).toEqual([]);
      expect(c.replica.range('task_completions', c.date, c.date)).toEqual([]);
      expect(c.outbox.count()).toBe(0);
      expect(c.fileSystem.requests).toEqual([]);
    },
  );

  test.each(['together', 'per_pet'] as const)(
    'AF-1 / R3.45 %s capture commits the completion and outbox before the first upload', async (mode) => {
      const c = await photoProofContext(mode);
      const upload = deferred<HttpResponse>();
      // Snapshot at the transport boundary. Assertions stay outside the
      // callback because the upload loop classifies thrown errors as network failures.
      let atUpload: unknown;
      c.fileSystem.enqueue(() => {
        atUpload = {
          completions: Object.values(c.store.getState().completions),
          replica: c.replica.range('task_completions', c.date, c.date),
          outbox: c.outbox.head(c.sessionUser.id),
          files: c.driver.all('SELECT id, kind, local_uri, state, sha256 FROM asset_file'),
        };
        return upload.promise;
      });
      try {
        await render(cameraTree(c));
        await fireEvent.press(screen.getByTestId('camera-shutter'));
        expect(c.outbox.count()).toBe(0);
        expect(c.fileSystem.requests).toEqual([]);
        expect(c.driver.all('SELECT * FROM asset_file')).toEqual([]);
        const completedAt = new Date(c.clock.now()).toISOString();
        await fireEvent.press(screen.getByTestId('camera-use'));
        await act(async () => {});

        const rows = Object.values(c.store.getState().completions);
        expect(rows).toHaveLength(1);
        const row = rows[0];
        if (row === undefined) throw new Error('The captured completion is missing');
        expect(row.photo_asset_id).not.toBeNull();
        const photoId = row.photo_asset_id;
        if (photoId === null) throw new Error('The captured completion has no photo');
        const uri = `file:///fake/documents/assets/${photoId}.jpg`;
        expect(row).toMatchObject({ task_id: c.target.taskId, occurrence_key: c.target.occurrenceKey,
          pet_id: c.target.petId, completed_by: c.sessionUser.id, completed_at: completedAt });
        expect(c.device.compress).toHaveBeenCalledWith(fakePhoto, { longestEdge: 1600, quality: 0.7 });
        expect(c.device.writeFile).toHaveBeenCalledWith('file:///fake/compressed.jpg', photoId);
        expect(c.fileSystem.read(uri)).toEqual(new Uint8Array([1, 2, 3]));
        expect(c.onClose).toHaveBeenCalledTimes(1);
        expect(c.outbox.count()).toBe(1);
        expect(c.fileSystem.requests).toEqual([expect.objectContaining({ method: 'PUT', uri,
          url: expect.stringContaining(`/assets/${photoId}?kind=task_proof`),
          headers: expect.objectContaining({ 'X-Content-SHA256': fakePhotoHash }) })]);
        expect(atUpload).toMatchObject({
          completions: [row], replica: [{ row }],
          outbox: { entityId: row.id, method: 'POST', path: '/completions',
            body: { id: row.id, photo_asset_id: photoId, pet_id: c.target.petId } },
          files: [{ id: photoId, kind: 'task_proof', local_uri: uri, state: 'to_upload', sha256: fakePhotoHash }],
        });
        if (mode === 'per_pet') expect(rows.some((completion) => completion.pet_id === c.second.id)).toBe(false);
        // The star is already lit while the upload promise remains pending.
        await cleanup();
        await paintPhotoCard(c);
        expect(screen.getByTestId(c.checkId)).toBeChecked();
        await act(async () => { upload.resolve(response(201)); await c.files.uploads.kick(); });
        expect(c.files.uploadState(photoId)).toBe('uploaded');
      } finally {
        await act(async () => { upload.resolve(response(201)); });
      }
    },
  );
});
