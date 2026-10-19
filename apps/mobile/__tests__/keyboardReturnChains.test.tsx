import { createElement, useImperativeHandle, type ReactElement, type Ref } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { TextInputProps } from 'react-native';
import { AssetFilesProvider } from '../src/assets/useAssetFile';
import { response } from '../src/auth/__tests__/support';
import { authContext, credentials } from '../src/features/auth/__tests__/support';
import { RedeemScreen } from '../src/features/auth/RedeemScreen';
import { FamilyScreen } from '../src/features/family/FamilyScreen';
import { HealthFormScreen } from '../src/features/health/HealthFormScreen';
import { petContext } from '../src/features/pets/__tests__/support';
import { PetFormScreen } from '../src/features/pets/PetFormScreen';
import { WeightFormScreen } from '../src/features/pets/WeightFormScreen';
import { settingsContext } from '../src/features/settings/__tests__/support';
import { PasswordScreen } from '../src/features/settings/PasswordScreen';
import { taskContext } from '../src/features/tasks/__tests__/support';
import { TaskFormScreen } from '../src/features/tasks/TaskFormScreen';
import { strings } from '../src/i18n/strings';
import { ReplicaProvider } from '../src/replica/useReplica';
import * as ReduceMotion from '../src/ui/motion/useReduceMotion';

// R1: observe native focus through the barrel getter, as loginKeyboard does.
const focusCalls = jest.fn<void, [string | undefined]>();
function FocusableInput({ ref, ...props }: TextInputProps & { ref?: Ref<{ focus(): void }> }) {
  useImperativeHandle(ref, () => ({ focus: () => { focusCalls(props.accessibilityLabel); } }));
  return createElement('TextInput', props);
}

let dispose: (() => void) | undefined;
let requests: readonly unknown[] = [];

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  focusCalls.mockClear();
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(native, 'TextInput', 'get').mockReturnValue(FocusableInput as unknown as typeof native.TextInput);
});

afterEach(async () => {
  await cleanup();
  dispose?.();
  dispose = undefined;
  expect(requests).toEqual([]);
  requests = [];
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function change(label: string, value: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(label), value);
}

async function expectChain(labels: readonly string[]): Promise<void> {
  for (let index = 0; index < labels.length - 1; index += 1) {
    const label = labels[index];
    if (label === undefined) throw new Error('Missing field label');
    const field = screen.getByLabelText(label);
    expect(field).toHaveProp('returnKeyType', 'next');
    focusCalls.mockClear();
    await fireEvent(field, 'submitEditing');
    expect(focusCalls.mock.calls).toEqual([[labels[index + 1]]]);
  }
}

async function expectSaveParity(options: {
  content: ReactElement;
  fill(): Promise<void>;
  labels: readonly [string, ...string[]];
  button: string;
  calls(): readonly (readonly unknown[])[];
  expected: readonly unknown[];
}): Promise<void> {
  for (const [index, method] of (['return', 'button'] as const).entries()) {
    await render(options.content);
    await options.fill();
    await expectChain(options.labels);
    expect(options.calls()).toHaveLength(index);
    const last = options.labels.at(-1);
    if (last === undefined) throw new Error('Missing final field');
    expect(screen.getByLabelText(last)).toHaveProp('returnKeyType', 'done');
    if (method === 'return') await fireEvent(screen.getByLabelText(last), 'submitEditing');
    else await fireEvent.press(screen.getByTestId(options.button));
    expect(options.calls()).toHaveLength(index + 1);
    expect(options.calls()[index]).toEqual(options.expected);
    await cleanup();
  }
}

test('R1 / 09 §1 redeem return keys focus name, email, password and submit like the primary button', async () => {
  const c = await authContext();
  dispose = c.dispose;
  const redeem = jest.spyOn(c.services.session, 'redeem');
  c.http.enqueue(response(410), response(410));
  const body = { code: 'ABCDEFGHIJ', display_name: 'Test member', ...credentials };
  await expectSaveParity({
    content: <RedeemScreen services={c.services} active={false} onLayout={jest.fn()} />,
    async fill() {
      await change(strings.auth.redeemCode, body.code);
      await change(strings.auth.redeemName, body.display_name);
      await change(strings.auth.redeemEmail, body.email);
      await change(strings.auth.password, body.password);
    },
    labels: [strings.auth.redeemCode, strings.auth.redeemName, strings.auth.redeemEmail, strings.auth.password],
    button: 'redeem-submit', calls: () => redeem.mock.calls, expected: [body],
  });
  expect(c.http.requests).toHaveLength(2);
});

test('R1 / 09 §1 new pet return keys focus breed, coat, microchip, notes and save like the primary button', async () => {
  const c = await petContext();
  dispose = c.dispose;
  requests = c.http.requests;
  await expectSaveParity({
    content: <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
      <PetFormScreen services={c.services} active={false} onClose={c.onClose} onAvatar={c.onAvatar} />
    </AssetFilesProvider></ReplicaProvider>,
    async fill() {
      await change(strings.pets.name, 'Aurora');
      await fireEvent.press(screen.getByRole('radio', { name: strings.pets.cat }));
      await change(strings.pets.breed, 'Mixed');
      await change(strings.pets.color, 'Black');
      await change(strings.pets.microchip, '123456789012345');
      await change(strings.pets.notes, 'Gentle');
    },
    labels: [strings.pets.name, strings.pets.breed, strings.pets.color, strings.pets.microchip, strings.pets.notes],
    button: 'pet-save', calls: () => c.createPet.mock.calls,
    expected: [{ name: 'Aurora', species: 'cat', sex: 'unknown', breed: 'Mixed', color: 'Black',
      microchip_id: '123456789012345', notes: 'Gentle', birthdate: null, avatar_asset_id: null }],
  });
  expect(c.onClose).toHaveBeenCalledTimes(2);
});

test('R1 / 09 §1 weight return keys focus date, note and save like the primary button', async () => {
  const c = await petContext();
  dispose = c.dispose;
  requests = c.http.requests;
  const pet = c.seedPet();
  const save = jest.spyOn(c.mutations, 'createWeight');
  await expectSaveParity({
    content: <ReplicaProvider store={c.store}>
      <WeightFormScreen services={c.services} active={false} petId={pet.id} onClose={c.onClose} />
    </ReplicaProvider>,
    async fill() { await change(strings.weights.value, '4.25'); await change(strings.weights.note, 'After breakfast'); },
    labels: [strings.weights.value, strings.weights.measuredAt, strings.weights.note],
    button: 'weight-save', calls: () => save.mock.calls,
    expected: [{ pet_id: pet.id, weight_kg: 4.25, measured_at: new Date(c.clock.now()).toISOString(), note: 'After breakfast' }],
  });
  expect(c.onClose).toHaveBeenCalledTimes(2);
});

test('R1 / 09 §1 health return keys focus occurred date, due date, notes and save like the primary button', async () => {
  const c = await petContext();
  dispose = c.dispose;
  requests = c.http.requests;
  const pet = c.seedPet();
  const save = jest.spyOn(c.mutations, 'createHealthEvent');
  await expectSaveParity({
    content: <ReplicaProvider store={c.store}>
      <HealthFormScreen services={c} active={false} petId={pet.id} onClose={c.onClose} onAttachment={jest.fn()} />
    </ReplicaProvider>,
    async fill() {
      await fireEvent.press(screen.getByRole('radio', { name: strings.health.types.vaccine }));
      await change(strings.health.title, 'Annual vaccine');
      await change(strings.health.notes, 'No reaction');
    },
    labels: [strings.health.title, strings.health.occurredAt, strings.health.nextDueOn, strings.health.notes],
    button: 'health-save', calls: () => save.mock.calls,
    expected: [{ pet_id: pet.id, type: 'vaccine', title: 'Annual vaccine',
      occurred_at: new Date(c.clock.now()).toISOString(), next_due_on: null, notes: 'No reaction', attachment_asset_id: null }],
  });
  expect(c.onClose).toHaveBeenCalledTimes(2);
});

test.each([true, false])('R1 / 09 §1 task return keys follow timer enabled=%s and save like the primary button', async (timer) => {
  const c = await taskContext();
  dispose = c.dispose;
  requests = c.http.requests;
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], timer_seconds: timer ? 300 : null });
  await expectSaveParity({
    content: <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
      <TaskFormScreen services={c.services} active={false} taskId={task.id} onClose={c.onClose} />
    </AssetFilesProvider></ReplicaProvider>,
    async fill() { await change(strings.tasks.title, 'Evening care'); await change(strings.tasks.description, 'Use the blue bowl'); },
    labels: timer ? [strings.tasks.title, strings.tasks.minutes, strings.tasks.description]
      : [strings.tasks.title, strings.tasks.description],
    button: 'task-save', calls: () => c.patchTask.mock.calls,
    expected: [task.id, { title: 'Evening care', description: 'Use the blue bowl', category: task.category,
      assigned_to: task.assigned_to, requires_photo: task.requires_photo, timer_seconds: timer ? 300 : null,
      reminder_class: task.reminder_class, sort_order: task.sort_order }],
  });
  expect(c.onClose).toHaveBeenCalledTimes(2);
});

test('R1 / 09 §1 password return keys focus new password and save like the primary button', async () => {
  const c = await settingsContext();
  dispose = c.dispose;
  requests = c.http.requests;
  await expectSaveParity({
    content: <PasswordScreen services={c.services} active onClose={c.onClose} />,
    async fill() {
      await change(strings.settings.currentPassword, credentials.password);
      await change(strings.settings.newPassword, 'replacement-test-password');
    },
    labels: [strings.settings.currentPassword, strings.settings.newPassword],
    button: 'password-save', calls: () => c.actions.changePassword.mock.calls,
    expected: [credentials.password, 'replacement-test-password'],
  });
  expect(c.onClose).toHaveBeenCalledTimes(2);
});

test('R1 / 09 §1 family return keys focus timezone and save like the primary button', async () => {
  const c = await settingsContext();
  dispose = c.dispose;
  requests = c.http.requests;
  await expectSaveParity({
    content: <ReplicaProvider store={c.store}><FamilyScreen services={c.services} active /></ReplicaProvider>,
    async fill() { await change(strings.family.name, 'Our family'); await change(strings.family.timezone, 'UTC'); },
    labels: [strings.family.name, strings.family.timezone],
    button: 'family-save', calls: () => c.actions.patchFamily.mock.calls,
    expected: [{ name: 'Our family', timezone: 'UTC' }],
  });
});
