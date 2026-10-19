import { validatePet } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AssetImage } from '../../../assets/AssetImage';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatValidationError } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { PetFormScreen } from '../PetFormScreen';
import { PetsGridScreen } from '../PetsGridScreen';
import { petContext, type PetContext } from './support';

let context: PetContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene(role: Parameters<typeof petContext>[0] = 'leader') {
  const c = await petContext(role);
  context = c;
  return c;
}

async function paint(c: PetContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>{children}</AssetFilesProvider>
  </ReplicaProvider>);
}

function grid(c: PetContext) {
  return <PetsGridScreen services={c.services} active onAdd={c.onAdd} onOpenPet={c.onOpenPet} />;
}

function form(c: PetContext, petId?: string) {
  return <PetFormScreen services={c.services} active {...(petId === undefined ? {} : { petId })}
    onClose={c.onClose} onAvatar={c.onAvatar} />;
}

async function fillPet(name: string) {
  await fireEvent.changeText(screen.getByTestId('pet-name'), name);
  await fireEvent.press(within(screen.getByTestId('pet-species')).getByRole('radio', { name: strings.pets.cat }));
}

test('R2.1 grid orders replica pets by sort_order then name and follows store changes', async () => {
  const c = await scene();
  const last = c.seedPet({ name: 'Zeta', sort_order: 2 });
  const second = c.seedPet({ name: 'Vega', sort_order: 1 });
  const first = c.seedPet({ name: 'Atlas', sort_order: 1 });
  await paint(c, grid(c));
  const cardIds = () => screen.getAllByTestId(/^pet-card-/).map((card) => card.props.testID);
  expect(cardIds()).toEqual([first, second, last].map((pet) => `pet-card-${pet.id}`));
  await act(() => { c.seedPet({ ...last, sort_order: 0 }); });
  expect(cardIds()).toEqual([last, first, second].map((pet) => `pet-card-${pet.id}`));
  expect(c.http.requests).toEqual([]);
});

test('R2.2 archived pets and the archived section are hidden from members', async () => {
  const c = await scene('member');
  const live = c.seedPet();
  const archived = c.seedPet({ name: 'Vega', archived_at: new Date(c.clock.now()).toISOString() });
  await paint(c, grid(c));
  expect(screen.getByTestId(`pet-card-${live.id}`)).toBeOnTheScreen();
  expect(screen.queryByTestId(`pet-card-${archived.id}`)).toBeNull();
  expect(screen.queryByTestId('pets-archived')).toBeNull();
});

test('R2.2 leaders reveal archived pets under the counted archived section', async () => {
  const c = await scene();
  const live = c.seedPet();
  const archived = c.seedPet({ name: 'Vega', archived_at: new Date(c.clock.now()).toISOString() });
  await paint(c, grid(c));
  expect(screen.getAllByTestId(/^pet-card-/)).toHaveLength(1);
  expect(screen.getByTestId(`pet-card-${live.id}`)).toBeOnTheScreen();
  expect(screen.queryByTestId(`pet-card-${archived.id}`)).toBeNull();
  expect(screen.getByTestId('pets-archived')).toHaveTextContent(strings.pets.archived(1));
  await fireEvent.press(screen.getByTestId('pets-archived'));
  expect(screen.getByTestId(`pet-card-${archived.id}`)).toHaveTextContent(archived.name);
});

test('R2.1 local validatePet limits refuse a 41-character name without enqueueing', async () => {
  const c = await scene();
  const name = 'A'.repeat(41);
  const errors = validatePet({ name, species: 'cat' });
  expect(errors).toEqual([{ field: 'name', code: 'out_of_range' }]);
  await paint(c, form(c));
  await fillPet(name);
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(formatValidationError({ field: 'name', code: 'out_of_range' }));
  expect(c.createPet).not.toHaveBeenCalled();
  expect(c.outbox.count()).toBe(0);
  expect(c.store.getState().pets).toEqual({});
  expect(c.onClose).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test('R2.1 saving calls createPet once and closes after the local replica and outbox write', async () => {
  const c = await scene();
  await paint(c, form(c));
  await fillPet('Aurora');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(c.createPet).toHaveBeenCalledTimes(1);
  expect(c.createPet).toHaveBeenCalledWith(expect.objectContaining({ name: 'Aurora', species: 'cat' }));
  const id = c.createPet.mock.results[0]?.value as string | undefined;
  expect(Object.values(c.store.getState().pets)).toEqual([
    expect.objectContaining({ id, name: 'Aurora', species: 'cat' }),
  ]);
  expect(c.outbox.count()).toBe(1);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({
    method: 'POST', path: '/pets', entityId: id,
    body: expect.objectContaining({ id, name: 'Aurora', species: 'cat' }),
  });
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test('R2.2 a member editing a pet sees no archive button', async () => {
  const c = await scene('member');
  const pet = c.seedPet();
  await paint(c, form(c, pet.id));
  expect(screen.getByTestId('pet-name')).toHaveDisplayValue(pet.name);
  expect(screen.getByTestId('pet-save')).toBeOnTheScreen();
  expect(screen.queryByTestId('pet-archive')).toBeNull();
});

test('R2.2 a leader editing a pet sees the archive button', async () => {
  const c = await scene();
  const pet = c.seedPet();
  await paint(c, form(c, pet.id));
  expect(screen.getByTestId('pet-archive')).toBeOnTheScreen();
});

test('R2.3 R3.46 AssetImage shows its placeholder while the local asset is pending', async () => {
  const c = await scene();
  const assetId = c.ids.uuid();
  expect(await c.files.ensureFile(assetId)).toEqual({ status: 'pending' });
  await paint(c, <AssetImage assetId={assetId} accessibilityLabel="Avatar"
    placeholder={<View testID="pending-avatar" />} />);
  expect(screen.getByTestId('pending-avatar')).toBeOnTheScreen();
  expect(screen.queryByRole('image')).toBeNull();
  expect(c.fileSystem.requests).toEqual([]);
  expect(c.http.requests).toEqual([]);
});
