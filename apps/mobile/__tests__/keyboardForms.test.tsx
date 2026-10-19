import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react-native';
import { View } from 'react-native';
import { AssetFilesProvider } from '../src/assets/useAssetFile';
import { authContext } from '../src/features/auth/__tests__/support';
import { LoginScreen } from '../src/features/auth/LoginScreen';
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
import { ReplicaProvider } from '../src/replica/useReplica';
import * as ReduceMotion from '../src/ui/motion/useReduceMotion';
import * as Form from '../src/ui/primitives/KeyboardAwareForm';

let dispose: (() => void) | undefined;
let requests: readonly unknown[] = [];

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  // Observe adoption and containment independently of the primitive's Red stub.
  jest.spyOn(Form, 'KeyboardAwareForm').mockImplementation(({ children }) => <View testID="shared-form-probe">{children}</View>);
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

function expectContained(fieldIds: readonly string[], submitId: string) {
  expect(Form.KeyboardAwareForm).toHaveBeenCalled();
  const containers = screen.getAllByTestId('shared-form-probe');
  expect(containers.some((container) => {
    const form = within(container);
    const allFields = screen.root?.queryAll((node) => node.type === 'TextInput') ?? [];
    const containedFields = container.queryAll((node) => node.type === 'TextInput');
    return allFields.length > 0 && containedFields.length === allFields.length
      && [...fieldIds, submitId].every((id) => form.queryByTestId(id) !== null);
  })).toBe(true);
}

test.each(['login', 'redeem'] as const)('09 §1 %s contains every field and primary action in the shared form', async (name) => {
  const c = await authContext();
  dispose = c.dispose;
  requests = c.http.requests;
  await render(name === 'login'
    ? <LoginScreen services={c.services} active={false} onRedeem={jest.fn()} onLayout={jest.fn()} />
    : <RedeemScreen services={c.services} active={false} onLayout={jest.fn()} />);
  expectContained(name === 'login' ? ['login-email', 'login-password']
    : ['redeem-code', 'redeem-name', 'redeem-email', 'redeem-password'], `${name}-submit`);
  if (name === 'login') {
    for (const container of screen.getAllByTestId('shared-form-probe')) {
      expect(within(container).queryByTestId('powered-by')).toBeNull();
    }
    expect(screen.getByTestId('powered-by')).toBeOnTheScreen();
  }
});

test.each(['new pet', 'edit pet', 'weight', 'new health', 'edit health'] as const)(
  '09 §1 %s contains every field and primary action in the shared form', async (name) => {
    const c = await petContext();
    dispose = c.dispose;
    requests = c.http.requests;
    const pet = c.seedPet();
    const event = c.factory.health_events({ pet_id: pet.id });
    c.apply.applyLocalRow('health_events', event);
    let content: ReactNode;
    let fields: string[];
    let submitId: string;
    if (name === 'new pet' || name === 'edit pet') {
      content = <PetFormScreen services={c.services} active={false} onClose={c.onClose} onAvatar={c.onAvatar}
        {...(name === 'edit pet' ? { petId: pet.id } : {})} />;
      fields = ['pet-name'];
      submitId = 'pet-save';
    } else if (name === 'weight') {
      content = <WeightFormScreen services={c.services} active={false} petId={pet.id} onClose={c.onClose} />;
      fields = ['weight-value', 'weight-measured-at', 'weight-note'];
      submitId = 'weight-save';
    } else {
      content = <HealthFormScreen services={c} active={false} petId={pet.id} onClose={c.onClose} onAttachment={jest.fn()}
        {...(name === 'edit health' ? { eventId: event.id } : {})} />;
      fields = ['health-title', 'health-occurred-at', 'health-next-due-on', 'health-notes'];
      submitId = 'health-save';
    }
    await render(<ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>{content}</AssetFilesProvider></ReplicaProvider>);
    expectContained(fields, submitId);
  },
);

test.each(['new task', 'edit task'] as const)('09 §1 %s contains its fields and primary action in the shared form', async (name) => {
  const c = await taskContext();
  dispose = c.dispose;
  requests = c.http.requests;
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], timer_seconds: 300 });
  await render(<ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <TaskFormScreen services={c.services} active={false} onClose={c.onClose}
      {...(name === 'edit task' ? { taskId: task.id } : {})} />
  </AssetFilesProvider></ReplicaProvider>);
  expectContained(['task-title'], 'task-save');
});

test.each(['password', 'family'] as const)('09 §1 %s contains its fields and primary action in the shared form', async (name) => {
  const c = await settingsContext();
  dispose = c.dispose;
  requests = c.http.requests;
  await render(<ReplicaProvider store={c.store}>{name === 'password'
    ? <PasswordScreen services={c.services} active={false} onClose={c.onClose} />
    : <FamilyScreen services={c.services} active={false} />}</ReplicaProvider>);
  expectContained(name === 'password' ? ['password-current', 'password-new'] : ['family-name'],
    name === 'password' ? 'password-save' : 'family-save');
});
