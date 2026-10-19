import { AssetRepo, type AssetFile } from '../../db/assetRepo';
import { petContext, type PetContext } from '../../features/pets/__tests__/support';

let context: PetContext | undefined;

afterEach(() => { context?.dispose(); context = undefined; });

test.each<AssetFile['state']>(['to_upload', 'uploaded', 'downloaded', 'failed'])(
  'R3.46 uploadState reads the durable %s state without a write or transfer', async (state) => {
    const c = await petContext();
    context = c;
    const repo = new AssetRepo(c.driver);
    const row = c.factory.assetFile({ kind: 'health_attachment', state });
    c.driver.transaction(() => { repo.upsert(row); });
    const before = c.driver.export();
    expect(c.files.uploadState(row.id)).toBe(state);
    expect(c.driver.export()).toEqual(before);
    expect(c.fileSystem.requests).toEqual([]);
    expect(c.http.requests).toEqual([]);
    expect(c.outbox.count()).toBe(0);
  },
);

test('R3.46 uploadState returns null for an unknown attachment without starting a transfer', async () => {
  const c = await petContext();
  context = c;
  expect(c.files.uploadState(c.ids.uuid())).toBeNull();
  expect(c.fileSystem.requests).toEqual([]);
  expect(c.http.requests).toEqual([]);
  expect(c.outbox.count()).toBe(0);
});
