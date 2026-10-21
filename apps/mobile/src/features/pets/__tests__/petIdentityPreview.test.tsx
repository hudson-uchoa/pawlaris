import { identityIndexForId } from '@pawlaris/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import * as Theme from '../../../ui/theme';
import { identity, light } from '../../../ui/tokens/color';
import { PetFormScreen } from '../PetFormScreen';
import { petContext, type PetContext } from './support';

let context: PetContext | undefined;

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
});

test('R2.13 the unsaved derived preview uses the eventual pet ID without a write', async () => {
  const c = await petContext();
  context = c;
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme: 'light', color: light });
  const reserve = jest.spyOn(c.mutations, 'reservePetId');
  await render(<ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <PetFormScreen services={c.services} active onClose={c.onClose} onAvatar={c.onAvatar} />
  </AssetFilesProvider></ReplicaProvider>);
  await fireEvent.press(within(screen.getByTestId('pet-species')).getByRole('radio', { name: strings.pets.cat }));
  const id = reserve.mock.results[0]?.value as string | undefined;
  expect(typeof id).toBe('string');
  if (id === undefined) throw new Error('Expected a reserved pet ID');
  const entry = identity[identityIndexForId(id)] ?? identity[0];
  expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveStyle({ backgroundColor: entry.light });
  expect(c.store.getState().pets).toEqual({});
  expect(c.outbox.count()).toBe(0);
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(reserve).toHaveBeenCalledTimes(1);
  expect(c.store.getState().pets[id]).toMatchObject({ id, identity_color: null });
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ entityId: id, body: { id, identity_color: null } });
  expect(c.http.requests).toEqual([]);
});

test('R2.13 clearing an edited swatch restores the derived preview and queues null', async () => {
  const c = await petContext();
  context = c;
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme: 'light', color: light });
  const selected = identity[1];
  const pet = c.seedPet({ identity_color: selected.key });
  await render(<ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <PetFormScreen services={c.services} petId={pet.id} active onClose={c.onClose} onAvatar={c.onAvatar} />
  </AssetFilesProvider></ReplicaProvider>);
  const swatch = within(screen.getByTestId('pet-identity')).getByRole('radio', { name: selected.name });
  expect(swatch).toBeChecked();
  expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveStyle({ backgroundColor: selected.light });
  await fireEvent.press(swatch);
  expect(swatch).not.toBeChecked();
  const derived = identity[identityIndexForId(pet.id)] ?? identity[0];
  expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveStyle({ backgroundColor: derived.light });
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(c.store.getState().pets[pet.id]?.identity_color).toBeNull();
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'PATCH', body: { identity_color: null } });
  expect(c.http.requests).toEqual([]);
});
