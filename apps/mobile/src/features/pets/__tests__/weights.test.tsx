import type { WeightEntry } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatDateTime, formatDecimal, formatValidationError } from '../../../i18n/format';
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

test('R2.5 pressing save twice records one weight and closes once', async () => {
  const c = await scene();
  const pet = c.seedPet();
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,25');
  await fireEvent.press(screen.getByTestId('weight-save'));
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(c.outbox.count()).toBe(1);
  expect(Object.values(c.store.getState().weightEntries).filter((entry) => entry.pet_id === pet.id))
    .toEqual([expect.objectContaining({ pet_id: pet.id, weight_kg: 4.25 })]);
  expect(c.onClose).toHaveBeenCalledTimes(1);
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

test('R2.5 edited family date and note save once and notify before closing', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const onSaved = jest.fn(() => {
    expect(c.outbox.count()).toBe(1);
    expect(c.onClose).not.toHaveBeenCalled();
  });
  await paint(c, <WeightFormScreen services={c.services} petId={pet.id} active onClose={c.onClose} onSaved={onSaved} />);
  expect(screen.getByTestId('weight-value').props.keyboardType).toBe('decimal-pad');
  expect(screen.getByTestId('weight-measured-at')).toHaveDisplayValue(formatDateTime(c.clock.now(), 'America/Sao_Paulo'));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,25');
  await fireEvent.changeText(screen.getByTestId('weight-measured-at'), '12/10/2026 23:15');
  await fireEvent.changeText(screen.getByTestId('weight-note'), 'After dinner');
  await fireEvent.press(screen.getByTestId('weight-save'));
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ body: {
    pet_id: pet.id, weight_kg: 4.25, measured_at: '2026-10-13T02:15:00.000Z', note: 'After dinner',
  } });
  expect(c.outbox.count()).toBe(1);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test('R2.7 confirmation compares the latest measurement for this pet, excluding older and foreign entries', async () => {
  const c = await scene();
  const pet = c.seedPet();
  seedWeight(c, { pet_id: pet.id, weight_kg: 4 });
  seedWeight(c, { pet_id: pet.id, weight_kg: 12, measured_at: new Date(c.clock.now() - 86_400_000).toISOString() });
  const other = c.seedPet({ name: 'Atlas' });
  seedWeight(c, { pet_id: other.id, weight_kg: 20, measured_at: new Date(c.clock.now() + 1000).toISOString() });
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), '4,50');
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ body: { pet_id: pet.id, weight_kg: 4.5 } });
});

test.each(['4,250', '4.255'])('R2.5 VL-6 input precision %s is rejected before enqueueing', async (value) => {
  const c = await scene();
  const pet = c.seedPet();
  await paint(c, form(c, pet.id));
  await fireEvent.changeText(screen.getByTestId('weight-value'), value);
  await fireEvent.press(screen.getByTestId('weight-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(formatValidationError({ field: 'weight_kg', code: 'out_of_range' }));
  expect(c.outbox.count()).toBe(0);
});

test('R2.4 R2.6 R1.19 profile shows five recent weights and care from every assignee for this pet only', async () => {
  const c = await scene();
  const pet = c.seedPet({ birthdate: '2023-10-13' });
  const otherPet = c.seedPet({ name: 'Atlas' });
  const weights = Array.from({ length: 7 }, (_, index) => seedWeight(c, { pet_id: pet.id,
    weight_kg: 4 + index / 10, measured_at: new Date(c.clock.now() - index * 86_400_000).toISOString() }));
  seedWeight(c, { pet_id: otherPet.id, weight_kg: 10 });
  const member = c.factory.members({ display_name: 'Duda' });
  const due = c.factory.task_templates({ title: 'Shared care', assigned_to: member.id,
    pet_ids: [pet.id, otherPet.id], completion_mode: 'per_pet' });
  const done = c.factory.task_templates({ title: 'Finished care', assigned_to: member.id, pet_ids: [pet.id] });
  const unrelated = c.factory.task_templates({ title: 'Other pet care', pet_ids: [otherPet.id] });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('members', member);
    for (const task of [due, done, unrelated]) c.apply.applyLocalRow('task_templates', task);
    c.apply.applyLocalRow('task_completions', c.factory.task_completions({
      task_id: due.id, pet_id: otherPet.id, completed_by: member.id, occurrence_key: '2026-10-13T08:00',
    }));
    c.apply.applyLocalRow('task_completions', c.factory.task_completions({
      task_id: done.id, pet_id: null, completed_by: member.id, occurrence_key: '2026-10-13T08:00',
    }));
  });
  const onEdit = jest.fn();
  await paint(c, <PetProfileScreen services={c.services} petId={pet.id} active
    onEdit={onEdit} onAddWeight={c.onAdd} onWalks={jest.fn()} />);
  expect(screen.getByText([strings.pets.profileSpecies.cat.female, `3 ${strings.format.year[1]}`, strings.pets.mixedBreed].join(' · ')))
    .toBeOnTheScreen();
  expect(screen.getByTestId('weight-latest')).toHaveTextContent(strings.weights.kilograms(formatDecimal(4, 2)));
  expect(screen.getAllByTestId(/^weight-entry-/).map((row) => row.props.testID))
    .toEqual(weights.slice(0, 5).map((entry) => `weight-entry-${entry.id}`));
  const care = within(screen.getByTestId('pet-care'));
  expect(care.getByText(due.title)).toBeOnTheScreen();
  expect(care.getByText(done.title)).toBeOnTheScreen();
  expect(care.queryByText(unrelated.title)).toBeNull();
  const dueRow = within(care.getByTestId(`pet-care-${due.id}-2026-10-13T08:00`));
  expect(dueRow.getByText('08:00')).toBeOnTheScreen();
  expect(dueRow.getAllByText(/.+/)).toHaveLength(2);
  expect(care.getByText(/^Duda ·/)).toBeOnTheScreen();
  expect(screen.queryByTestId('pet-walks')).toBeNull();
  expect(screen.queryByTestId('health-add')).toBeNull();
  await fireEvent.press(screen.getByTestId('pet-edit'));
  await fireEvent.press(screen.getByTestId('weight-add'));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(c.onAdd).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test('R1.19 profile labels completed care with who and when and leaves later care unlabelled', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const member = c.factory.members({ display_name: 'Duda' });
  const task = c.factory.task_templates({ title: 'Daily care', pet_ids: [pet.id],
    assigned_to: member.id, times_of_day: ['08:00', '18:00'] });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('members', member);
    c.apply.applyLocalRow('task_templates', task);
    c.apply.applyLocalRow('task_completions', c.factory.task_completions({
      task_id: task.id, completed_by: member.id, occurrence_key: '2026-10-13T08:00',
      completed_at: '2026-10-13T11:05:00.000Z',
    }));
  });
  await paint(c, <PetProfileScreen services={c.services} petId={pet.id} active
    onEdit={jest.fn()} onAddWeight={c.onAdd} onWalks={jest.fn()} />);
  const done = within(screen.getByTestId(`pet-care-${task.id}-2026-10-13T08:00`));
  expect(done.getByText('08:00')).toBeOnTheScreen();
  expect(done.getByText('Duda · 08:05')).toBeOnTheScreen();
  const later = within(screen.getByTestId(`pet-care-${task.id}-2026-10-13T18:00`));
  expect(later.getByText(task.title)).toBeOnTheScreen();
  expect(later.getByText('18:00')).toBeOnTheScreen();
  expect(later.getAllByText(/.+/)).toHaveLength(2);
  expect(c.http.requests).toEqual([]);
});

test('R1.19 dog profile shows its three newest finished walks and opens the walks tab', async () => {
  const c = await scene();
  const pet = c.seedPet({ species: 'dog' });
  const otherPet = c.seedPet({ species: 'dog', name: 'Atlas' });
  const walks = Array.from({ length: 4 }, (_, index) => c.factory.walk_sessions({ pet_id: pet.id, status: 'finished',
    started_at: new Date(c.clock.now() - index * 86_400_000).toISOString(), ended_at: new Date(c.clock.now()).toISOString() }));
  c.driver.transaction(() => {
    for (const walk of [...walks, c.factory.walk_sessions({ pet_id: pet.id }),
      c.factory.walk_sessions({ pet_id: otherPet.id, status: 'finished' })]) c.apply.applyLocalRow('walk_sessions', walk);
  });
  const onWalks = jest.fn();
  await paint(c, <PetProfileScreen services={c.services} petId={pet.id} active
    onEdit={jest.fn()} onAddWeight={c.onAdd} onWalks={onWalks} />);
  expect(screen.getAllByTestId(/^pet-walk-/).map((row) => row.props.testID))
    .toEqual(walks.slice(0, 3).map((walk) => `pet-walk-${walk.id}`));
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.viewAll }));
  expect(onWalks).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});
