import { localDate } from '@pawlaris/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { hydrateReplica } from '../../replica/apply';
import { selectDayView } from '../../replica/selectors';
import { ReplicaProvider } from '../../replica/useReplica';
import { settingsContext, type SettingsContext } from '../../features/settings/__tests__/support';
import { DiagnosticsScreen } from '../../features/settings/DiagnosticsScreen';
import * as ReduceMotion from '../../ui/motion/useReduceMotion';
import { seedPerformance } from '../seed';

let context: SettingsContext | undefined;
const previousFlag = process.env.EXPO_PUBLIC_PERF_SEED;

beforeEach(() => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_PERF_SEED;
  else process.env.EXPO_PUBLIC_PERF_SEED = previousFlag;
  jest.restoreAllMocks();
});

test.each([undefined, '', '0', 'true'])('P7-4 Diagnostics omits the seed unless the flag is exactly 1 (%s)', async (flag) => {
  if (flag === undefined) delete process.env.EXPO_PUBLIC_PERF_SEED;
  else process.env.EXPO_PUBLIC_PERF_SEED = flag;
  const c = await settingsContext();
  context = c;
  c.diagnosticServices.seedPerformance = () => { seedPerformance(c); };
  await render(<ReplicaProvider store={c.store}><DiagnosticsScreen services={c.diagnosticServices} active /></ReplicaProvider>);
  expect(screen.queryByTestId('diag-perf-seed')).toBeNull();
});

test('P7-4 flagged release Diagnostics seeds ninety durable occurrences without HTTP and is repeatable', async () => {
  process.env.EXPO_PUBLIC_PERF_SEED = '1';
  const c = await settingsContext({ status: 'offline' });
  context = c;
  c.diagnosticServices.seedPerformance = () => { seedPerformance(c); };
  await render(<ReplicaProvider store={c.store}><DiagnosticsScreen services={c.diagnosticServices} active /></ReplicaProvider>);
  const button = screen.getByTestId('diag-perf-seed');
  expect(button).toBeEnabled();
  expect(button.props.accessibilityRole).toBe('button');
  expect(button.props.accessibilityLabel).toBeTruthy();
  await fireEvent.press(button);
  const date = localDate(c.clock.now(), c.family.timezone);
  const read = () => {
    const view = selectDayView(c.store.getState(), { date, now: c.clock.now(), me: c.user.id, scope: 'mine' });
    return [...view.overdue, ...view.now, ...view.later, ...view.done];
  };
  expect(read()).toHaveLength(90);
  expect(new Set(read().map((row) => row.taskId))).toHaveProperty('size', 90);
  expect(c.outbox.count()).toBe(91);
  const mutations = c.driver.all<{ id: string }>('SELECT client_mutation_id AS id FROM outbox');
  expect(new Set(mutations.map((entry) => entry.id)).size).toBe(91);
  hydrateReplica(c);
  expect(read()).toHaveLength(90);
  await fireEvent.press(button);
  expect(read()).toHaveLength(90);
  expect(c.outbox.count()).toBe(91);
  expect(c.http.requests).toEqual([]);
});

test('P7-4 seed preserves existing family rows and commits as one batch', async () => {
  const c = await settingsContext();
  context = c;
  const petId = c.mutations.createPet({ name: 'Existing pet', species: 'cat' });
  const before = c.replica.get('pets', petId);
  const changes = jest.fn();
  const unsubscribe = c.store.subscribe(changes);
  seedPerformance(c);
  unsubscribe();
  expect(changes).toHaveBeenCalledTimes(1);
  expect(c.replica.get('pets', petId)).toEqual(before);
});
