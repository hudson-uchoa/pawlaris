import type { WeightEntry } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatDecimal, formatValidationError } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { PetProfileScreen } from '../PetProfileScreen';
import { WeightChart } from '../WeightChart';
import { WeightFormScreen } from '../WeightFormScreen';
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

function seedWeight(c: PetContext, overrides: Partial<WeightEntry>): WeightEntry {
  const entry = c.factory.weight_entries(overrides);
  c.driver.transaction(() => { c.apply.applyLocalRow('weight_entries', entry); });
  return entry;
}

async function paint(c: PetContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>{children}</AssetFilesProvider>
  </ReplicaProvider>);
}

function form(c: PetContext, petId: string) {
  return <WeightFormScreen services={c.services} petId={petId} active onClose={c.onClose} />;
}

test.each([0, 1])('R2.6 %i weight entries show an empty state without chart axes', async (count) => {
  const c = await scene();
  const pet = c.seedPet();
  const entries = count === 0 ? [] : [seedWeight(c, { pet_id: pet.id })];
  await paint(c, <WeightChart entries={entries} width={300} height={180}
    timezone="America/Sao_Paulo" active />);
  expect(screen.getByText(strings.weights.empty)).toBeOnTheScreen();
  expect(screen.queryByTestId('weight-chart')).toBeNull();
  expect(c.http.requests).toEqual([]);
});

test('R2.7 changing 2.00 to 12.00 asks for confirmation before writing', async () => {
  const c = await scene();
  const pet = c.seedPet();
  seedWeight(c, { pet_id: pet.id, weight_kg: 2 });
  const createWeight = jest.spyOn(c.mutations, 'createWeight');
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '12,00');
  await fireEvent.press(screen.getByTestId('weight-save'));
  const sheet = screen.getByRole('dialog');
  expect(within(sheet).getByText(strings.weights.confirmation(formatDecimal(2, 2), formatDecimal(12, 2))))
    .toBeOnTheScreen();
  expect(within(sheet).getByRole('button', { name: strings.weights.correct })).toBeOnTheScreen();
  expect(createWeight).not.toHaveBeenCalled();
  expect(c.outbox.count()).toBe(0);
  expect(Object.values(c.store.getState().weightEntries)).toHaveLength(1);
  expect(c.onClose).not.toHaveBeenCalled();
  await fireEvent.press(within(sheet).getByTestId('weight-confirm'));
  expect(createWeight).toHaveBeenCalledTimes(1);
  expect(createWeight).toHaveBeenCalledWith(expect.objectContaining({ pet_id: pet.id, weight_kg: 12 }));
  expect(c.outbox.count()).toBe(1);
  expect(Object.values(c.store.getState().weightEntries)).toHaveLength(2);
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test('R2.7 changing 4.00 to 4.50 saves without a confirmation sheet', async () => {
  const c = await scene();
  const pet = c.seedPet();
  seedWeight(c, { pet_id: pet.id, weight_kg: 4 });
  const createWeight = jest.spyOn(c.mutations, 'createWeight');
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,50');
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(createWeight).toHaveBeenCalledTimes(1);
  expect(createWeight).toHaveBeenCalledWith(expect.objectContaining({ pet_id: pet.id, weight_kg: 4.5 }));
  expect(c.outbox.count()).toBe(1);
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test('R2.5 a comma decimal saves its numeric value locally with injected UTC time', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const createWeight = jest.spyOn(c.mutations, 'createWeight');
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,25');
  await fireEvent.press(screen.getByTestId('weight-save'));
  const expected = { pet_id: pet.id, weight_kg: 4.25, measured_at: new Date(c.clock.now()).toISOString() };
  expect(createWeight).toHaveBeenCalledTimes(1);
  expect(createWeight).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(Object.values(c.store.getState().weightEntries)).toEqual([expect.objectContaining(expected)]);
  expect(c.outbox.count()).toBe(1);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({
    method: 'POST', path: '/weights', body: expect.objectContaining(expected),
  });
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test('R2.5 VL-6 three decimals are refused locally without rounding or enqueueing', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const createWeight = jest.spyOn(c.mutations, 'createWeight');
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,255');
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(formatValidationError({ field: 'weight_kg', code: 'out_of_range' }));
  expect(screen.getByTestId('weight-value')).toHaveDisplayValue('4,255');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(createWeight).not.toHaveBeenCalled();
  expect(c.outbox.count()).toBe(0);
  expect(c.store.getState().weightEntries).toEqual({});
  expect(c.onClose).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test('R2.8 deleting a profile weight removes only that entry and enqueues its DELETE', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const removed = seedWeight(c, { pet_id: pet.id, weight_kg: 4 });
  const kept = seedWeight(c, { pet_id: pet.id, weight_kg: 4.25,
    measured_at: new Date(c.clock.now() - 86_400_000).toISOString() });
  const deleteWeight = jest.spyOn(c.mutations, 'deleteWeight');
  await paint(c, <PetProfileScreen services={c.services} petId={pet.id} active
    onEdit={jest.fn()} onAddWeight={c.onAdd} onWalks={jest.fn()} />);
  expect(screen.getByTestId(`weight-entry-${removed.id}`)).toBeOnTheScreen();
  expect(screen.getByTestId(`weight-entry-${kept.id}`)).toBeOnTheScreen();
  await fireEvent(screen.getByTestId(`weight-entry-${removed.id}`), 'longPress');
  await fireEvent.press(screen.getByRole('button', { name: strings.weights.delete }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  expect(deleteWeight).toHaveBeenCalledTimes(1);
  expect(deleteWeight).toHaveBeenCalledWith(removed.id);
  expect(screen.queryByTestId(`weight-entry-${removed.id}`)).toBeNull();
  expect(screen.getByTestId(`weight-entry-${kept.id}`)).toBeOnTheScreen();
  expect(c.store.getState().weightEntries[removed.id]).toBeUndefined();
  expect(c.store.getState().weightEntries[kept.id]).toMatchObject(kept);
  expect(screen.getByText(strings.weights.empty)).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(1);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({
    method: 'DELETE', path: `/weights/${removed.id}`, entityId: removed.id,
  });
  expect(c.http.requests).toEqual([]);
});
