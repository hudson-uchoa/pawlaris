import type { Completion, TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import PetProfile from '../../../../app/pet/[id]';
import NewTask from '../../../../app/task/new';
import { AppProvider } from '../../../appContext';
import { createAppRuntime, type AppRuntime } from '../../../bootstrap';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { servers } from '../../../auth/__tests__/support';
import { formatFullDate, formatMonth } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import { fakeLogFiles } from '../../../testing/fakeLogFiles';
import { fakeWebSocket } from '../../../testing/fakeWebSocket';
import { HeroProvider } from '../../../ui/motion/hero';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { ToastProvider } from '../../../ui/primitives/Toast';
import { PetProfileScreen } from '../PetProfileScreen';
import { petContext, type PetContext } from './support';

// Only the navigation boundary is replaced; routes, screens and stores are real.
jest.mock('expo-router', () => ({
  useIsFocused: () => true, useLocalSearchParams: jest.fn(), useRouter: jest.fn(),
}));

let context: PetContext | undefined;
let runtime: AppRuntime | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  runtime?.dispose();
  runtime = undefined;
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene() {
  const c = await petContext();
  context = c;
  const pet = c.seedPet();
  const member = c.factory.members({ display_name: 'Duda' });
  c.driver.transaction(() => { c.apply.applyLocalRow('members', member); });
  return { c, pet, member };
}

function seedCare(c: PetContext, taskFields: Partial<TaskTemplate>, completionFields: Partial<Completion>) {
  const task = c.factory.task_templates({ category: 'vet', completion_mode: 'per_pet',
    title: 'Renamed treatment', starts_on: '2026-09-01', ...taskFields });
  const completion = c.factory.task_completions({ task_id: task.id,
    title_snapshot: 'Original treatment', completed_at: '2026-10-12T11:02:00.000Z',
    occurrence_key: '2026-10-10T08:00', ...completionFields });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('task_templates', task);
    c.apply.applyLocalRow('task_completions', completion);
  });
  return { task, completion };
}

function profile(c: PetContext, petId: string) {
  return <PetProfileScreen services={c.services} petId={petId} active
    onEdit={jest.fn()} onAddWeight={c.onAdd} onWalks={jest.fn()}
    onAddHealth={jest.fn()} onOpenHealth={jest.fn()} />;
}

async function paint(c: PetContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}><HeroProvider active={false}>{children}</HeroProvider></AssetFilesProvider>
  </ReplicaProvider>);
}

test.each(['vet', 'medication'] as const)(
  'R2.14 the profile renders live %s care with its saved title, member and family time', async (category) => {
    const { c, pet, member } = await scene();
    const { task, completion } = seedCare(c, { category, pet_ids: [pet.id] }, {
      pet_id: pet.id, completed_by: member.id,
    });
    await paint(c, profile(c, pet.id));
    expect(c.http.requests).toEqual([]);
    expect(c.fileSystem.requests).toEqual([]);
    expect(screen.queryByRole('progressbar')).toBeNull();
    const row = within(screen.getByTestId(`health-care-${completion.id}`));
    expect(row.getByText(completion.title_snapshot)).toBeOnTheScreen();
    expect(row.queryByText(task.title)).toBeNull();
    expect(row.getByText('Duda · 08:02')).toBeOnTheScreen();
    expect(row.getByText(formatFullDate('2026-10-12'))).toBeOnTheScreen();
    expect(row.getByLabelText(strings.tasks.categories[category])).toBeOnTheScreen();
    expect(within(screen.getByTestId('health-month-2026-10'))
      .getByTestId(`health-care-${completion.id}`)).toBeOnTheScreen();
    expect(c.http.requests).toEqual([]);
    expect(c.fileSystem.requests).toEqual([]);
    expect(c.outbox.count()).toBe(0);
  },
);

test('R2.12 R2.14 the profile interleaves events and together care in family month groups', async () => {
  const { c, pet, member } = await scene();
  const otherPet = c.seedPet({ name: 'Atlas' });
  const { completion } = seedCare(c, { pet_ids: [pet.id, otherPet.id], completion_mode: 'together' }, {
    pet_id: null, completed_by: member.id, completed_at: '2026-10-01T01:30:00.000Z',
    occurrence_key: '2026-09-10T08:00',
  });
  const newest = c.factory.health_events({ pet_id: pet.id, occurred_at: '2026-10-12T12:00:00.000Z' });
  const older = c.factory.health_events({ pet_id: pet.id, occurred_at: '2026-09-29T12:00:00.000Z' });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('health_events', older);
    c.apply.applyLocalRow('health_events', newest);
  });
  await paint(c, profile(c, pet.id));
  const health = within(screen.getByTestId('pet-health'));
  expect(health.getAllByTestId(/^health-month-/).map((node) => node.props.testID))
    .toEqual(['health-month-2026-10', 'health-month-2026-09']);
  expect(health.getAllByTestId(/^health-(event|care)-/).map((node) => node.props.testID))
    .toEqual([`health-event-${newest.id}`, `health-care-${completion.id}`, `health-event-${older.id}`]);
  const september = within(screen.getByTestId('health-month-2026-09'));
  expect(september.getByRole('header', { name: formatMonth('2026-09') })).toBeOnTheScreen();
  expect(september.getByTestId(`health-care-${completion.id}`)).toHaveTextContent('Duda · 22:30', { exact: false });
  expect(c.http.requests).toEqual([]);
});

test('R2.14 a replica undo removes the care row immediately without requesting data', async () => {
  const { c, pet, member } = await scene();
  const { completion } = seedCare(c, { pet_ids: [pet.id] }, { pet_id: pet.id, completed_by: member.id });
  await paint(c, profile(c, pet.id));
  expect(screen.getByTestId(`health-care-${completion.id}`)).toBeOnTheScreen();
  await act(() => {
    c.driver.transaction(() => { c.apply.applyLocalRow('task_completions', {
      ...completion, undone_at: new Date(c.clock.now()).toISOString(), undone_by: member.id,
    }); });
  });
  expect(screen.queryByTestId(`health-care-${completion.id}`)).toBeNull();
  expect(c.http.requests).toEqual([]);
  expect(c.outbox.count()).toBe(0);
});

test('R2.14 ADR-042 the new task route applies the treatment pet and category presets', async () => {
  const { c, pet } = await scene();
  const otherPet = c.seedPet({ name: 'Atlas' });
  jest.mocked(useLocalSearchParams).mockReturnValue({ petId: pet.id, category: 'vet' });
  navigation();
  const app = routeRuntime(c);
  await render(routeTree(app, <NewTask />));
  expect(c.http.requests).toEqual([]);
  expect(c.fileSystem.requests).toEqual([]);
  expect(c.outbox.count()).toBe(0);
  const pets = within(screen.getByTestId('task-pets'));
  expect(pets.getByRole('button', { name: pet.name }).props.accessibilityState.selected).toBe(true);
  expect(pets.getByRole('button', { name: otherPet.name }).props.accessibilityState.selected).toBe(false);
  expect(within(screen.getByTestId('task-category'))
    .getByRole('button', { name: strings.tasks.categories.vet }).props.accessibilityState.selected).toBe(true);
});

function routeRuntime(c: PetContext): AppRuntime {
  runtime = createAppRuntime({ ...c, servers, online: false,
    WebSocketImpl: fakeWebSocket().WebSocketImpl, logFiles: fakeLogFiles(),
    documentDirectory: 'file:///fake/documents/', perfOutput: jest.fn(),
  });
  return runtime;
}

function routeTree(app: AppRuntime, children: ReactNode) {
  return <AppProvider runtime={app}><HeroProvider active={false}>
    <ToastProvider dismissLabel={strings.dismiss}>{children}</ToastProvider>
  </HeroProvider></AppProvider>;
}

function navigation() {
  const push = jest.fn<void, [unknown]>();
  jest.mocked(useRouter).mockReturnValue({ push, back: jest.fn(), navigate: jest.fn(),
    replace: jest.fn(), dismiss: jest.fn(), dismissAll: jest.fn(), dismissTo: jest.fn(),
    canGoBack: () => true, canDismiss: () => false, setParams: jest.fn(), prefetch: jest.fn(), reload: jest.fn(),
  });
  return push;
}

test('R2.14 09 section 4.3 tapping a care item opens its task without a request', async () => {
  const { c, pet, member } = await scene();
  const { task, completion } = seedCare(c, { pet_ids: [pet.id] }, { pet_id: pet.id, completed_by: member.id });
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: pet.id });
  const push = navigation();
  await render(routeTree(routeRuntime(c), <PetProfile />));
  await fireEvent.press(screen.getByTestId(`health-care-${completion.id}`));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith({ pathname: expect.stringMatching(/task\/\[id\]$/), params: { id: task.id } });
  expect(c.http.requests).toEqual([]);
  expect(c.outbox.count()).toBe(0);
});

test('R2.14 ADR-042 health-schedule opens the real new task form with only this pet and vet selected', async () => {
  const { c, pet } = await scene();
  const otherPet = c.seedPet({ name: 'Atlas' });
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: pet.id });
  const push = navigation();
  const app = routeRuntime(c);
  const view = await render(routeTree(app, <PetProfile />));
  await fireEvent.press(screen.getByTestId('health-schedule'));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith({
    pathname: expect.stringMatching(/task\/new$/), params: { petId: pet.id, category: 'vet' },
  });
  const destination = push.mock.calls[0]?.[0];
  if (typeof destination !== 'object' || destination === null || !('params' in destination)) {
    throw new Error('Expected task form navigation parameters');
  }
  jest.mocked(useLocalSearchParams).mockReturnValue(destination.params as { petId: string; category: string });
  await view.rerender(routeTree(app, <NewTask />));
  const pets = within(screen.getByTestId('task-pets'));
  expect(pets.getByRole('button', { name: pet.name }).props.accessibilityState.selected).toBe(true);
  expect(pets.getByRole('button', { name: otherPet.name }).props.accessibilityState.selected).toBe(false);
  expect(within(screen.getByTestId('task-category'))
    .getByRole('button', { name: strings.tasks.categories.vet }).props.accessibilityState.selected).toBe(true);
  expect(c.http.requests).toEqual([]);
  expect(c.fileSystem.requests).toEqual([]);
  expect(c.outbox.count()).toBe(0);
});
