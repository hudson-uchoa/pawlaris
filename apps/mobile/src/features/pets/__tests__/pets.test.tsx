import { validatePet } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AssetImage } from '../../../assets/AssetImage';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { response } from '../../../auth/__tests__/support';
import { formatFullDate, formatValidationError } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { PetFormScreen } from '../PetFormScreen';
import { PetsGridScreen } from '../PetsGridScreen';
import { PetCard } from '../PetCard';
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
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.unarchive }));
  expect(c.store.getState().pets[archived.id]?.archived_at).toBeNull();
  expect(screen.getByTestId('pets-archived')).toHaveTextContent(strings.pets.archived(0));
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({
    method: 'POST', path: `/pets/${archived.id}/unarchive`, entityId: archived.id,
  });
  expect(c.http.requests).toEqual([]);
});

test('R2.1 the empty grid offers pet-add and a card opens its pet', async () => {
  const c = await scene();
  await paint(c, grid(c));
  expect(screen.getByRole('header', { name: strings.pets.emptyTitle })).toBeOnTheScreen();
  expect(screen.getByTestId('pet-add')).toHaveTextContent(strings.pets.addPet);
  await fireEvent.press(screen.getByTestId('pet-add'));
  expect(c.onAdd).toHaveBeenCalledTimes(1);
  let petId = '';
  await act(() => { petId = c.seedPet().id; });
  expect(screen.queryByText(strings.pets.emptyTitle)).toBeNull();
  await fireEvent.press(screen.getByTestId(`pet-card-${petId}`));
  expect(c.onOpenPet).toHaveBeenCalledWith(petId);
});

test('R2.4 PetCard derives age and keeps its orbit static', async () => {
  const c = await scene();
  const pet = c.seedPet({ birthdate: '2025-06-13' });
  await paint(c, <PetCard pet={pet} now={c.clock.now()} timezone="America/Sao_Paulo"
    active onPress={c.onAdd} />);
  const age = `1 ${strings.format.year[0]}${strings.format.conjunction}4 ${strings.format.month[1]}`;
  expect(within(screen.getByTestId(`pet-card-${pet.id}`)).getByText(age)).toBeOnTheScreen();
  expect(screen.getByTestId(`pet-orbit-${pet.id}`)).toBeOnTheScreen();
  expect(screen.queryByTestId(`pet-orbit-${pet.id}-satellite`)).toBeNull();
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

test('R2.1 pressing save twice creates one pet, enqueues once and closes once', async () => {
  const c = await scene();
  await paint(c, form(c));
  await fillPet('Aurora');
  await fireEvent.press(screen.getByTestId('pet-save'));
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(c.createPet).toHaveBeenCalledTimes(1);
  expect(c.outbox.count()).toBe(1);
  expect(Object.values(c.store.getState().pets)).toHaveLength(1);
  expect(c.onClose).toHaveBeenCalledTimes(1);
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

test('R2.1 missing name and species show required messages without a write', async () => {
  const c = await scene();
  await paint(c, form(c));
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(screen.getAllByRole('alert').map((alert) => alert.props.children)).toEqual([
    formatValidationError({ field: 'name', code: 'required' }),
    formatValidationError({ field: 'species', code: 'required' }),
  ]);
  expect(c.outbox.count()).toBe(0);
  expect(c.onClose).not.toHaveBeenCalled();
});

test('R2.1 edit preserves species, saves all fields and delegates the photo action', async () => {
  const c = await scene();
  const pet = c.seedPet({ breed: 'Mixed', color: 'Black', birthdate: '2020-01-02', microchip_id: '123', notes: 'Quiet' });
  await paint(c, form(c, pet.id));
  await fireEvent.press(screen.getByTestId('pet-avatar'));
  expect(c.onAvatar).toHaveBeenCalledTimes(1);
  expect(c.outbox.count()).toBe(0);
  const dog = within(screen.getByTestId('pet-species')).getByRole('radio', { name: strings.pets.dog });
  expect(dog).toBeDisabled();
  await fireEvent.press(dog);
  expect(within(screen.getByTestId('pet-species')).getByRole('radio', { name: strings.pets.cat })).toBeChecked();
  for (const [label, value] of [[strings.pets.breed, pet.breed], [strings.pets.color, pet.color],
    [strings.pets.microchip, pet.microchip_id], [strings.pets.notes, pet.notes]] as const) {
    expect(screen.getByLabelText(label)).toHaveDisplayValue(value ?? '');
  }
  await fireEvent.changeText(screen.getByLabelText(strings.pets.notes), 'Updated locally');
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.birthdate }));
  const picker = screen.getByRole('dialog', { name: strings.pets.birthdate });
  await fireEvent.press(within(picker).getByRole('button', { name: formatFullDate('2020-01-03') }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(c.createPet).not.toHaveBeenCalled();
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'PATCH', path: `/pets/${pet.id}`, body: {
    name: pet.name, sex: pet.sex, breed: pet.breed, color: pet.color, birthdate: '2020-01-03',
    microchip_id: pet.microchip_id, notes: 'Updated locally', avatar_asset_id: null,
  } });
  expect(c.store.getState().pets[pet.id]).toMatchObject({ species: 'cat', notes: 'Updated locally', birthdate: '2020-01-03' });
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test('R2.1 clearing an optional breed saves null in the PATCH body and replica', async () => {
  const c = await scene();
  const pet = c.seedPet({ breed: 'Mixed' });
  await paint(c, form(c, pet.id));
  expect(screen.getByLabelText(strings.pets.breed)).toHaveDisplayValue('Mixed');
  await fireEvent.changeText(screen.getByLabelText(strings.pets.breed), '');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({
    method: 'PATCH', path: `/pets/${pet.id}`, body: { breed: null },
  });
  expect(c.store.getState().pets[pet.id]?.breed).toBeNull();
});

test.each([
  ['female', 'A ', 'dismiss'], ['female', 'A ', 'confirm'],
  ['male', 'O ', 'dismiss'], ['male', 'O ', 'confirm'],
  ['unknown', '', 'dismiss'], ['unknown', '', 'confirm'],
] as const)('R2.2 archive uses %s article "%s" and waits for confirmation: %s', async (sex, article, decision) => {
  const c = await scene();
  const pet = c.seedPet({ name: 'Aurora', sex });
  await paint(c, form(c, pet.id));
  await fireEvent.press(screen.getByTestId('pet-archive'));
  const sheet = screen.getByRole('dialog', { name: strings.pets.archive });
  const body = within(sheet).getByText(strings.pets.archiveBody(pet.name, pet.sex));
  expect(body).toBeOnTheScreen();
  expect(body).toHaveTextContent(new RegExp(`^${article}${pet.name} `));
  expect(c.outbox.count()).toBe(0);
  expect(c.store.getState().pets[pet.id]?.archived_at).toBeNull();
  await fireEvent.press(within(sheet).getByRole('button', { name: decision === 'confirm' ? strings.pets.archive : strings.dismiss }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  if (decision === 'confirm') {
    expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'POST', path: `/pets/${pet.id}/archive` });
    expect(c.store.getState().pets[pet.id]?.archived_at).toBe(new Date(c.clock.now()).toISOString());
    expect(c.onClose).toHaveBeenCalledTimes(1);
  } else {
    expect(c.outbox.count()).toBe(0);
    expect(c.store.getState().pets[pet.id]?.archived_at).toBeNull();
    expect(c.onClose).not.toHaveBeenCalled();
  }
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(c.http.requests).toEqual([]);
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

test('R2.3 AssetImage renders the cached file through expo-image', async () => {
  const c = await scene();
  const asset = c.factory.assets({ kind: 'pet_avatar' });
  c.driver.transaction(() => { c.apply.applyLocalRow('assets', asset); });
  c.fileSystem.enqueue(response(200, new Uint8Array([1, 2, 3])));
  const file = await c.files.ensureFile(asset.id);
  expect(file.status).toBe('ready');
  await paint(c, <AssetImage assetId={asset.id} accessibilityLabel="Avatar"
    placeholder={<View testID="pending-avatar" />} />);
  expect(screen.queryByTestId('pending-avatar')).toBeNull();
  expect(screen.getByRole('image', { name: 'Avatar' })).toBeOnTheScreen();
  expect(screen.getByRole('image', { name: 'Avatar' }).props.source).toEqual([
    expect.objectContaining({ uri: file.uri }),
  ]);
  expect(c.fileSystem.requests).toHaveLength(1);
  expect(c.fileSystem.requests[0]).toMatchObject({ method: 'GET', uri: file.uri });
});
