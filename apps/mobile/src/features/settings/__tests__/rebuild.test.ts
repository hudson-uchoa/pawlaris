import { rebuildLocalData } from '../../../diagnostics';
import { settingsContext, type SettingsContext } from './support';

let context: SettingsContext | undefined;
afterEach(() => { context?.dispose(); context = undefined; });

test('R7.4 rebuilding waits for the current cycle, keeps pending rows and outbox, and pulls from zero', async () => {
  const c = await settingsContext({ server: 'reserve' });
  context = c;
  const pending = c.factory.pets({ revision: null });
  const synced = c.factory.pets();
  c.driver.transaction(() => {
    c.apply.applyLocalRow('pets', pending);
    c.apply.applyServerRows([{ entity: 'pets', row: synced }]);
    c.outbox.insert(c.factory.outbox({ entityId: pending.id, userId: c.user.id }));
  });
  c.kv.set('last_revision.primary', '17');
  c.kv.set('last_revision.reserve', '23');
  const outbox = c.driver.all('SELECT * FROM outbox');
  const kick = jest.fn(async (_reason: string) => {
    if (kick.mock.calls.length === 1) {
      expect(c.replica.get('pets', synced.id)?.row).toEqual(synced);
      c.kv.set('last_revision.reserve', '24');
    } else {
      expect(c.kv.get('last_revision.reserve')).toBe('0');
      c.apply.applyServerRows([{ entity: 'pets', row: synced }]);
    }
  });
  await rebuildLocalData({ ...c, engine: { state: c.services.connection, kick } });
  expect(kick).toHaveBeenNthCalledWith(1, 'refresh');
  expect(kick).toHaveBeenNthCalledWith(2, 'refresh');
  expect(c.kv.get('last_revision.primary')).toBe('17');
  expect(c.driver.all('SELECT * FROM outbox')).toEqual(outbox);
  expect(c.store.getState().pets[pending.id]).toEqual(pending);
  expect(c.store.getState().pets[synced.id]).toEqual(synced);
});

test('R7.4 losing the connection before rebuilding leaves local data intact', async () => {
  const c = await settingsContext();
  context = c;
  const rows = c.driver.all('SELECT * FROM replica');
  const kick = jest.fn(async () => { c.setConnection({ status: 'offline' }); });
  await expect(rebuildLocalData({ ...c, engine: { state: c.services.connection, kick } }))
    .rejects.toThrow('Rebuilding requires a connection');
  expect(c.driver.all('SELECT * FROM replica')).toEqual(rows);
});
