import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { deferred, response, servers } from '../../auth/__tests__/support';
import { AssetRepo } from '../../db/assetRepo';
import type { HttpResponse } from '../../platform/http';
import { syncContext, type SyncContext } from '../../sync/__tests__/support';
import { createPull } from '../../sync/pull';
import { createWiredEngine } from '../../sync/wiring';
import { fakeFileSystem } from '../../testing/fakeFileSystem';
import { createAssetFiles } from '../files';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: jest.fn() },
  NetInfoStateType: { other: 'other' },
}));

let c: SyncContext;
const epoch = 'fake-epoch';

beforeEach(async () => {
  c = await syncContext(undefined, [0]);
  c.kv.set('reseeded_epoch.primary', epoch);
  jest.useFakeTimers({ now: c.clock.now() });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  c.driver.close();
});

test('avatar pull integration: start eager downloads after commit without delaying the pull', async () => {
  const asset = c.factory.assets({ kind: 'pet_avatar' });
  const pet = c.factory.pets({ avatar_asset_id: asset.id });
  c.http.enqueue(response(200, { changes: [{ entity: 'assets', row: asset }, { entity: 'pets', row: pet }],
    revision: 2, has_more: false, epoch }));
  const fileSystem = fakeFileSystem();
  const pending = deferred<HttpResponse>();
  fileSystem.enqueue(() => pending.promise);
  const files = createAssetFiles({ ...c, servers, activeServer: () => 'primary',
    fileSystem, documentDirectory: 'file:///fake/documents/' });
  const pull = createPull({ ...c, arrive: async () => 'ok', prefetchAvatars: files.prefetchAvatars });
  try {
    expect(await pull.pull()).toBe('ok');
    await jest.advanceTimersByTimeAsync(0);
    expect(c.kv.get('last_revision.primary')).toBe('2');
    expect(c.store.getState().pets[pet.id]).toEqual(pet);
    expect(fileSystem.requests).toHaveLength(1);
    expect(new AssetRepo(c.driver).get(asset.id)).toBeNull();
    pending.resolve(response(200));
    await jest.advanceTimersByTimeAsync(0);
    expect(new AssetRepo(c.driver).get(asset.id)?.state).toBe('downloaded');
  } finally {
    pending.resolve(response(200));
    files.uploads.dispose();
  }
});

test('avatar pull integration: an empty pull does not prefetch and a partial pull still does', async () => {
  const prefetchAvatars = jest.fn(async () => {});
  const pull = createPull({ ...c, arrive: async () => 'ok', prefetchAvatars });
  c.http.enqueue(response(200, { changes: [], revision: 1, has_more: false, epoch }));
  expect(await pull.pull()).toBe('ok');
  expect(prefetchAvatars).not.toHaveBeenCalled();
  c.http.enqueue(response(200, { changes: [{ entity: 'pets', row: c.factory.pets() }],
    revision: 2, has_more: true, epoch }), new Error('Simulated second-page failure'));
  expect(await pull.pull()).toBe('transient');
  expect(prefetchAvatars).toHaveBeenCalledTimes(1);
});

test('upload triggers: network recovery and foreground kick an independent pending upload', async () => {
  const originalState = AppState.currentState;
  AppState.currentState = 'background';
  let networkListener: Parameters<typeof NetInfo.addEventListener>[0] | undefined;
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  const unsubscribe = jest.fn();
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    networkListener = listener;
    return unsubscribe;
  });
  const remove = jest.fn();
  const appState = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove };
  });
  const pending = deferred<void>();
  const kick = jest.fn(() => pending.promise);
  const dispose = jest.fn();
  c.http.enqueue(response(200, { changes: [], revision: 1, has_more: false, epoch }),
    response(200, { changes: [], revision: 2, has_more: false, epoch }));
  const wired = createWiredEngine({
    ...c, outbox: c.drain, arrive: async () => 'ok',
    pull: createPull({ ...c, arrive: async () => 'ok' }),
    createSocket: () => ({ state: 'open', connect: async () => {}, close() {} }),
    uploads: { kick, dispose },
  });
  try {
    if (networkListener === undefined || appStateListener === undefined) {
      throw new Error('Expected native subscriptions');
    }
    const network = (reachable: boolean) => {
      networkListener?.({ type: NetInfoStateType.other, isConnected: reachable,
        isInternetReachable: reachable, details: { isConnectionExpensive: false } });
    };
    network(false);
    expect(kick).not.toHaveBeenCalled();
    network(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(kick).toHaveBeenCalledTimes(1);
    expect(wired.engine.state.getState().status).toBe('synced');
    network(true);
    expect(kick).toHaveBeenCalledTimes(1);
    appStateListener('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(kick).toHaveBeenCalledTimes(2);
    expect(wired.engine.state.getState().status).toBe('synced');
    wired.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    network(false);
    network(true);
    appStateListener('background');
    appStateListener('active');
    expect(kick).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    pending.resolve();
    appState.mockRestore();
    AppState.currentState = originalState;
    jest.mocked(NetInfo.addEventListener).mockReset();
    wired.dispose();
  }
});
