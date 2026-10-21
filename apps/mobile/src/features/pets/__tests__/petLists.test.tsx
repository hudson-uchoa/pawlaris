import { IDENTITY_KEYS, identityIndexForId, type Pet } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { processColor } from 'react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { expectedIdentityNames, expectedOtherLabel, expectedPetLists } from '../../../i18n/__tests__/petListExpectations';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import { HeroProvider } from '../../../ui/motion/hero';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import * as Theme from '../../../ui/theme';
import { dark, identity, light } from '../../../ui/tokens/color';
import { orbit } from '../../../ui/tokens/cosmos';
import { PetCard } from '../PetCard';
import { PetFormScreen } from '../PetFormScreen';
import { PetProfileScreen } from '../PetProfileScreen';
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

async function scene() {
  const c = await petContext();
  context = c;
  return c;
}

async function paint(c: PetContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}><HeroProvider active={false}>{children}</HeroProvider></AssetFilesProvider>
  </ReplicaProvider>);
}

function form(c: PetContext, petId?: string) {
  return <PetFormScreen services={c.services} active {...(petId === undefined ? {} : { petId })}
    onClose={c.onClose} onAvatar={c.onAvatar} />;
}

function surface(c: PetContext, pet: Pet, target: 'card' | 'profile') {
  return target === 'card'
    ? <PetCard pet={pet} now={c.clock.now()} timezone="America/Sao_Paulo" active onPress={c.onAdd} />
    : <PetProfileScreen services={c.services} petId={pet.id} active onEdit={c.onAdd}
      onAddWeight={c.onAdd} onAddHealth={c.onAdd} onOpenHealth={c.onOpenPet} onWalks={c.onAdd} />;
}

function control(id: string) {
  const element = screen.queryByTestId(id);
  expect(element).toBeOnTheScreen();
  if (element === null) throw new Error(`Expected control ${id}`);
  return element;
}

async function species(value: Pet['species']) {
  await fireEvent.press(within(screen.getByTestId('pet-species')).getByRole('radio', { name: strings.pets[value] }));
}

async function choose(field: 'breed' | 'coat', name: string) {
  await fireEvent.press(control(`pet-${field}`));
  const sheet = screen.getByRole('dialog', { name: field === 'breed' ? strings.pets.breed : strings.pets.color });
  await fireEvent.press(within(sheet).getByRole('button', { name }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
}

function expectSaved(c: PetContext, fields: Partial<Pet>) {
  expect(Object.values(c.store.getState().pets)).toEqual([expect.objectContaining(fields)]);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ body: expect.objectContaining(fields) });
  expect(c.http.requests).toEqual([]);
}

test('09 §4.2 breed and coat choices are disabled until a species is chosen', async () => {
  const c = await scene();
  await paint(c, form(c));
  expect(control('pet-breed')).toBeDisabled();
  expect(control('pet-coat')).toBeDisabled();
  await species('cat');
  expect(control('pet-breed')).not.toBeDisabled();
  expect(control('pet-coat')).not.toBeDisabled();
});

test.each(['cat', 'dog'] as const)('R2.13 / 09 §4.2 choosing a %s breed and coat stores keys locally', async (value) => {
  const c = await scene();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await species(value);
  await choose('breed', value === 'cat' ? expectedPetLists.breeds.cat.siamese : expectedPetLists.breeds.dog.shih_tzu);
  await choose('coat', value === 'cat' ? expectedPetLists.coats.cat.tuxedo : expectedPetLists.coats.dog.merle);
  await fireEvent.press(screen.getByTestId('pet-save'));
  expectSaved(c, { species: value, breed: value === 'cat' ? 'siamese' : 'shih_tzu', color: value === 'cat' ? 'tuxedo' : 'merle' });
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test('R2.13 / 09 §4.2 Other stores the typed breed and coat instead of a list key', async () => {
  const c = await scene();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await species('cat');
  await choose('breed', expectedOtherLabel);
  await fireEvent.changeText(control('pet-breed'), 'Family breed');
  await choose('coat', expectedOtherLabel);
  await fireEvent.changeText(control('pet-coat'), 'Silver with white paws');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expectSaved(c, { breed: 'Family breed', color: 'Silver with white paws' });
});

test('09 §4.2.1 picker search ignores case and accents and keeps Other available', async () => {
  const c = await scene();
  await paint(c, form(c));
  await species('cat');
  await fireEvent.press(control('pet-breed'));
  await fireEvent.changeText(control('pet-breed-search'), 'SIAMES');
  const sheet = screen.getByRole('dialog', { name: strings.pets.breed });
  expect(within(sheet).getByRole('button', { name: expectedPetLists.breeds.cat.siamese })).toBeOnTheScreen();
  expect(within(sheet).queryByRole('button', { name: expectedPetLists.breeds.cat.persian })).toBeNull();
  expect(within(sheet).getByRole('button', { name: expectedOtherLabel })).toBeOnTheScreen();
});

test.each(['list', 'text'] as const)('09 §4.2 changing species on a new pet clears %s breed and coat', async (source) => {
  const c = await scene();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await species('cat');
  await choose('breed', source === 'list' ? expectedPetLists.breeds.cat.siamese : expectedOtherLabel);
  if (source === 'text') await fireEvent.changeText(control('pet-breed'), 'Family breed');
  await choose('coat', source === 'list' ? expectedPetLists.coats.cat.tuxedo : expectedOtherLabel);
  if (source === 'text') await fireEvent.changeText(control('pet-coat'), 'Silver with white paws');
  await species('dog');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expectSaved(c, { species: 'dog', breed: null, color: null });
});

test.each(['card', 'profile'] as const)('R2.13 %s renders stored breed and coat keys by name', async (target) => {
  const c = await scene();
  const pet = c.seedPet({ species: 'cat', breed: 'siamese', color: 'tuxedo' });
  await paint(c, surface(c, pet, target));
  const body = within(screen.getByTestId(target === 'card' ? `pet-card-${pet.id}` : 'pet-profile'));
  expect(body.queryByText(expectedPetLists.breeds.cat.siamese, { exact: false })).toBeOnTheScreen();
  expect(body.queryByText(expectedPetLists.coats.cat.tuxedo, { exact: false })).toBeOnTheScreen();
  expect(body.queryByText(/siamese|tuxedo/)).toBeNull();
});

test.each(['card', 'profile'] as const)('R2.13 %s preserves free-text breed and coat verbatim', async (target) => {
  const c = await scene();
  const pet = c.seedPet({ breed: 'Family Breed', color: 'Silver With White Paws' });
  await paint(c, surface(c, pet, target));
  const body = within(screen.getByTestId(target === 'card' ? `pet-card-${pet.id}` : 'pet-profile'));
  expect(body.queryByText('Family Breed', { exact: false })).toBeOnTheScreen();
  expect(body.queryByText('Silver With White Paws', { exact: false })).toBeOnTheScreen();
});

test('09 §4.2 identity swatches announce body names in palette order', async () => {
  const c = await scene();
  await paint(c, form(c));
  expect(within(control('pet-identity')).getAllByRole('radio')
    .map((swatch) => swatch.props.accessibilityLabel)).toEqual(expectedIdentityNames);
});

test.each(IDENTITY_KEYS)('R2.13 / 09 §4.2 selecting swatch %s stores the palette key', async (key) => {
  const c = await scene();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await species('cat');
  const swatches = within(control('pet-identity'));
  const entry = identity.find((candidate) => candidate.key === key);
  expect(entry).toBeDefined();
  if (entry === undefined) throw new Error(`Expected palette key ${key}`);
  const swatch = swatches.getByRole('radio', { name: strings.pets.identityNames[entry.name] });
  await fireEvent.press(swatch);
  expect(swatch).toBeChecked();
  await fireEvent.press(screen.getByTestId('pet-save'));
  expectSaved(c, { identity_color: key });
});

test('R2.13 / 09 §4.2 leaving swatches unselected stores null', async () => {
  const c = await scene();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await species('cat');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expectSaved(c, { identity_color: null });
});

describe.each(['light', 'dark'] as const)('06 §2 identity colours in %s', (scheme) => {
  beforeEach(() => {
    jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme, color: scheme === 'dark' ? dark : light });
  });

  test.each([
    ['card', 'ring'], ['card', 'placeholder'], ['profile', 'ring'], ['profile', 'placeholder'],
  ] as const)('R2.13 chosen identity colours the %s %s', async (target, part) => {
    const c = await scene();
    const petId = c.ids.uuid();
    const selected = identity[(identityIndexForId(petId) + 1) % identity.length] ?? identity[0];
    const pet = c.seedPet({ id: petId, identity_color: selected.key });
    await paint(c, surface(c, pet, target));
    if (part === 'ring') {
      const rings = control(`pet-orbit-${pet.id}`).queryAll((node) => node.props.strokeWidth === orbit.strokeWidth);
      expect(rings.map((ring) => ring.props.stroke)).toEqual([{ type: 0, payload: processColor(selected[scheme]) }]);
    } else {
      expect(screen.getByRole('image', { name: pet.name })).toHaveStyle({ backgroundColor: selected[scheme] });
    }
  });

  test.each([
    ['card', 'ring'], ['card', 'placeholder'], ['profile', 'ring'], ['profile', 'placeholder'],
  ] as const)('R2.13 null identity derives the %s %s from the ID', async (target, part) => {
    const c = await scene();
    const pet = c.seedPet({ identity_color: null });
    const derived = identity[identityIndexForId(pet.id)] ?? identity[0];
    await paint(c, surface(c, pet, target));
    if (part === 'ring') {
      const rings = control(`pet-orbit-${pet.id}`).queryAll((node) => node.props.strokeWidth === orbit.strokeWidth);
      expect(rings.map((ring) => ring.props.stroke)).toEqual([{ type: 0, payload: processColor(derived[scheme]) }]);
    } else {
      expect(screen.getByRole('image', { name: pet.name })).toHaveStyle({ backgroundColor: derived[scheme] });
    }
  });
});
