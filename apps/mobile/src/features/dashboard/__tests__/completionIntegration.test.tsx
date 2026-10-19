import { localDate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, useColorScheme } from 'react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { DashboardScreen } from '../DashboardScreen';
import { dashboardContext, type DashboardContext } from './support';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

let context: DashboardContext | undefined;
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
});

afterEach(async () => {
  await cleanup();
  expect(context?.http.requests ?? []).toEqual([]);
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene() {
  const c = await dashboardContext();
  context = c;
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], times_of_day: [] });
  const date = localDate(c.clock.now(), 'America/Sao_Paulo');
  return { ...c, pet, task, date, checkId: `task-check-${task.id}-${date}` };
}

function tree(c: DashboardContext, active = true) {
  return <ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <DashboardScreen services={c.services} active={active} onAdd={c.onAdd}
      onManage={c.onManage} onOpenPet={c.onOpenPet} />
  </AssetFilesProvider></ReplicaProvider>;
}

async function advance(c: DashboardContext, milliseconds: number) {
  c.clock.advance(milliseconds);
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

test.each([
  ['light', false], ['dark', false], ['light', true], ['dark', true],
] as const)('R3.18 / 06 §4.2 dashboard holds the lit card for 400 ms in %s with Reduce Motion %s', async (scheme, reduced) => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(reduced);
  const c = await scene();
  await render(tree(c));
  await fireEvent.press(screen.getByTestId(c.checkId));
  expect(screen.getByTestId(c.checkId)).toBeChecked();
  expect(screen.getByTestId('section-now')).toBeOnTheScreen();
  expect(screen.queryByTestId('section-done')).toBeNull();
  expect(c.outbox.count()).toBe(1);
  await advance(c, 399);
  expect(screen.getByTestId(c.checkId)).toBeChecked();
  expect(screen.queryByTestId('section-done')).toBeNull();
  await advance(c, 1);
  expect(screen.queryByTestId('section-now')).toBeNull();
  expect(screen.queryByTestId(c.checkId)).toBeNull();
  expect(screen.getByTestId('section-done')).toBeCollapsed();
  await fireEvent.press(screen.getByTestId('section-done'));
  expect(screen.getByTestId(c.checkId)).toBeChecked();
  await fireEvent.press(screen.getByTestId(c.checkId));
  expect(screen.getByRole('dialog')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('undo-confirm'));
  expect(screen.getByTestId(c.checkId)).not.toBeChecked();
  expect(screen.getByTestId('section-now')).toBeOnTheScreen();
  expect(screen.queryByTestId('section-done')).toBeNull();
  expect(c.outbox.count()).toBe(2);
  const row = Object.values(c.store.getState().completions)[0];
  expect(row?.undone_by).toBe(c.sessionUser.id);
  // Coverage workers share the sql.js cold-start cost. The interaction's
  // 399/400 ms assertions use fake time; this limit only bounds the host run.
}, 30_000);

test('R6.7 / 06 §4.3 dashboard keeps partial pets in place and moves only after the final badge lights', async () => {
  const c = await scene();
  const second = c.seedPet({ name: 'Second pet' });
  const task = c.seedTask({ pet_ids: [c.pet.id, second.id], times_of_day: [], completion_mode: 'per_pet' });
  await render(tree(c));
  const cardId = `task-card-${task.id}-${c.date}`;
  await fireEvent.press(screen.getByTestId(`task-pet-${task.id}-${c.date}-${c.pet.id}`));
  await advance(c, 400);
  expect(within(screen.getByTestId(cardId)).getByText('1/2')).toBeOnTheScreen();
  expect(screen.queryByTestId('section-done')).toBeNull();
  await fireEvent.press(screen.getByTestId(`task-pet-${task.id}-${c.date}-${second.id}`));
  expect(within(screen.getByTestId(cardId)).getByText('2/2')).toBeOnTheScreen();
  expect(screen.getByTestId(`task-constellation-${task.id}-${c.date}`, { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.queryByTestId('section-done')).toBeNull();
  await advance(c, 400);
  expect(screen.getByTestId('section-done')).toHaveTextContent(strings.dashboard.done(1));
  expect(screen.queryByTestId(cardId)).toBeNull();
  expect(c.outbox.count()).toBe(2);
});

test('P6 leaving the dashboard during the hold settles its section without leaving motion running', async () => {
  const c = await scene();
  const view = await render(tree(c));
  await fireEvent.press(screen.getByTestId(c.checkId));
  await advance(c, 100);
  await view.rerender(tree(c, false));
  await advance(c, 1000);
  await view.rerender(tree(c));
  expect(screen.getByTestId('section-done')).toBeCollapsed();
  expect(screen.queryByTestId(c.checkId)).toBeNull();
  expect(screen.queryByTestId('section-now')).toBeNull();
  expect(c.outbox.count()).toBe(1);
});
