import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { deferred, response } from '../../../auth/__tests__/support';
import { strings } from '../../../i18n/strings';
import type { HttpResponse } from '../../../platform/http';
import { PhotoProofViewer } from '../PhotoProofViewer';
import {
  paintPhotoCard, photoProofContext, photoProofLifecycle, PhotoProofProviders,
  type PhotoProofContext,
} from './photoProofSupport';

jest.mock('react-native/Libraries/Utilities/useColorScheme');
photoProofLifecycle();

const photoLabels = [strings.health.photoUploading, strings.health.photoFailed, strings.health.photoPending];

async function localProof(c: PhotoProofContext, outcome: 'queued' | 'sent' | 'refused') {
  const id = c.ids.uuid();
  const uri = `file:///fake/documents/assets/${id}.jpg`;
  c.fileSystem.write(uri, new Uint8Array([1, 2, 3]));
  const upload = deferred<HttpResponse>();
  c.fileSystem.enqueue(outcome === 'queued' ? () => upload.promise : response(outcome === 'sent' ? 201 : 422));
  c.files.registerCapture({ id, kind: 'task_proof', localUri: uri, sha256: 'a'.repeat(64) });
  if (outcome !== 'queued') await c.files.uploads.kick();
  const completion = c.seedCompletion(c.task, { occurrence_key: c.date, photo_asset_id: id,
    completed_by: c.sessionUser.id, pet_id: c.target.petId });
  return { id, uri, completion, upload };
}

describe('TaskCard — photo proof', () => {
  test('R3.46 shows the queued label under its local thumbnail and removes it once sent', async () => {
    const c = await photoProofContext();
    const photo = await localProof(c, 'queued');
    try {
      await paintPhotoCard(c);
      expect(screen.getByText(strings.health.photoUploading)).toBeOnTheScreen();
      expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri: photo.uri }]);
      expect(screen.getByTestId(c.checkId)).toBeChecked();
      expect(screen.queryByText(strings.health.photoFailed)).toBeNull();
      expect(screen.queryByText(strings.health.photoPending)).toBeNull();
      expect(c.files.uploadState(photo.id)).toBe('to_upload');
      await act(async () => { photo.upload.resolve(response(201)); await c.files.uploads.kick(); });
      expect(c.files.uploadState(photo.id)).toBe('uploaded');
      expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri: photo.uri }]);
      for (const label of photoLabels) expect(screen.queryByText(label)).toBeNull();
      expect(screen.queryByTestId('photo-retry')).toBeNull();
      expect(screen.getByTestId(c.checkId)).toBeChecked();
      expect(c.fileSystem.requests).toHaveLength(1);
      expect(c.store.getState().completions[photo.completion.id]).toEqual(photo.completion);
    } finally {
      await act(async () => { photo.upload.resolve(response(201)); });
    }
  });

  test('R3.46 a refused proof shows the failure label and retains its thumbnail and checked completion', async () => {
    const c = await photoProofContext();
    const photo = await localProof(c, 'refused');
    await paintPhotoCard(c);
    expect(screen.getByText(strings.health.photoFailed)).toBeOnTheScreen();
    expect(screen.getByTestId('photo-retry')).toBeEnabled();
    expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri: photo.uri }]);
    expect(screen.getByTestId(c.checkId)).toBeChecked();
    expect(screen.queryByText(strings.health.photoUploading)).toBeNull();
    expect(screen.queryByText(strings.health.photoPending)).toBeNull();
    expect(c.files.uploadState(photo.id)).toBe('failed');
    expect(c.store.getState().completions[photo.completion.id]).toEqual(photo.completion);
    expect(c.outbox.count()).toBe(0);
  });

  test('R3.46 the receiving phone shows an incoming proof until the asset arrives and downloads locally', async () => {
    const c = await photoProofContext();
    const id = c.ids.uuid();
    const completion = c.seedCompletion(c.task, { occurrence_key: c.date, photo_asset_id: id,
      completed_by: c.other.id });
    await paintPhotoCard(c);
    expect(screen.getByText(strings.health.photoPending)).toBeOnTheScreen();
    expect(screen.queryByRole('image', { name: strings.pets.photo })).toBeNull();
    expect(screen.getByTestId(c.checkId)).toBeChecked();
    expect(c.fileSystem.requests).toEqual([]);
    c.fileSystem.enqueue(response(200));
    await act(async () => {
      c.apply.applyServerRows([{ entity: 'assets', row: c.factory.assets({ id, kind: 'task_proof' }) }]);
    });
    const uri = `file:///fake/documents/assets/${id}.jpg`;
    expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri }]);
    for (const label of photoLabels) expect(screen.queryByText(label)).toBeNull();
    expect(c.fileSystem.requests).toEqual([expect.objectContaining({ method: 'GET', uri,
      url: expect.stringContaining(`/assets/${id}/file`) })]);
    expect(c.store.getState().completions[completion.id]).toEqual(completion);
    expect(c.outbox.count()).toBe(0);
  });

  test('R3.47 / R3.46 retry re-queues the same proof, resets backoff and clears the failed label', async () => {
    const c = await photoProofContext();
    const id = c.ids.uuid();
    const uri = `file:///fake/documents/assets/${id}.jpg`;
    c.fileSystem.write(uri, new Uint8Array([1, 2, 3]));
    c.fileSystem.enqueue(response(500), response(422));
    c.files.registerCapture({ id, kind: 'task_proof', localUri: uri, sha256: 'a'.repeat(64) });
    await c.files.uploads.kick();
    const retry = c.driver.all<{ nextRetryAt: number }>(
      'SELECT next_retry_at AS nextRetryAt FROM asset_file WHERE id = ?', [id],
    )[0];
    if (retry === undefined) throw new Error('The registered proof file is missing');
    c.clock.advance(retry.nextRetryAt - c.clock.now());
    await c.files.uploads.kick();
    const completion = c.seedCompletion(c.task, { occurrence_key: c.date, photo_asset_id: id,
      completed_by: c.sessionUser.id });
    expect(c.driver.all('SELECT state, attempts FROM asset_file')).toEqual([{ state: 'failed', attempts: 1 }]);
    const upload = deferred<HttpResponse>();
    let atRetry: unknown;
    c.fileSystem.enqueue(() => {
      atRetry = c.driver.all('SELECT id, state, attempts, next_retry_at FROM asset_file');
      return upload.promise;
    });
    try {
      await paintPhotoCard(c);
      await fireEvent.press(screen.getByTestId('photo-retry'));
      await act(async () => {});
      expect(atRetry).toEqual([{ id, state: 'to_upload', attempts: 0, next_retry_at: 0 }]);
      expect(screen.getByText(strings.health.photoUploading)).toBeOnTheScreen();
      expect(screen.queryByText(strings.health.photoFailed)).toBeNull();
      expect(c.fileSystem.requests).toHaveLength(3);
      expect(c.fileSystem.requests[2]).toMatchObject({ method: 'PUT', uri,
        url: expect.stringContaining(`/assets/${id}?kind=task_proof`) });
      expect(screen.getByTestId(c.checkId)).toBeChecked();
      expect(c.store.getState().completions[completion.id]).toEqual(completion);
      expect(c.outbox.count()).toBe(0);
      await act(async () => { upload.resolve(response(201)); await c.files.uploads.kick(); });
      for (const label of photoLabels) expect(screen.queryByText(label)).toBeNull();
      expect(screen.queryByTestId('photo-retry')).toBeNull();
      expect(c.files.uploadState(id)).toBe('uploaded');
    } finally {
      await act(async () => { upload.resolve(response(201)); });
    }
  });

  test('R3.46 / 09 §3.3 tapping a sent thumbnail opens that proof without changing the completion', async () => {
    const c = await photoProofContext();
    const photo = await localProof(c, 'sent');
    await paintPhotoCard(c);
    await fireEvent.press(screen.getByRole('image', { name: strings.pets.photo }));
    expect(c.onOpenPhoto).toHaveBeenCalledTimes(1);
    expect(c.onOpenPhoto).toHaveBeenCalledWith(photo.id);
    expect(c.onOpenTask).not.toHaveBeenCalled();
    expect(c.store.getState().completions[photo.completion.id]).toEqual(photo.completion);
    expect(c.outbox.count()).toBe(0);
    expect(c.fileSystem.requests).toHaveLength(1);
  });
});

test('R3.46 / 09 §3.3 the full-screen proof viewer uses the saved file and can be dismissed', async () => {
  const c = await photoProofContext();
  const photo = await localProof(c, 'sent');
  await render(<PhotoProofProviders c={c}>
    <PhotoProofViewer assetId={photo.id} active onClose={c.onClose} />
  </PhotoProofProviders>);
  expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri: photo.uri }]);
  expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('contentFit', 'contain');
  await fireEvent.press(screen.getByRole('button', { name: strings.dismiss }));
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.fileSystem.requests).toHaveLength(1);
  expect(c.outbox.count()).toBe(0);
});
