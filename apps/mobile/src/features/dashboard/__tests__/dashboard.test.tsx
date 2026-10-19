import { addDays, localDate, type TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type RefreshControlProps } from 'react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatCareDue, formatDashboardDay } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { selectDayView } from '../../../replica/selectors';
import { createReplicaStore, type ReplicaStore } from '../../../replica/store';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { DashboardScreen } from '../DashboardScreen';
import { DayHeader } from '../DayHeader';
import { ScopeFilter } from '../ScopeFilter';
import { dashboardContext, type DashboardContext } from './support';

// The preset's RefreshControl renders a native placeholder without props.
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: function RefreshControl(props: RefreshControlProps) {
    return React.createElement(View, props);
  } };
});

let context: DashboardContext | undefined;
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  const requests = context?.http.requests ?? [];
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
  expect(requests).toEqual([]);
});

async function scene(role: Parameters<typeof dashboardContext>[0] = 'leader') {
  const c = await dashboardContext(role);
  context = c;
  return c;
}

function today(c: DashboardContext): string {
  return localDate(c.clock.now(), 'America/Sao_Paulo');
}

function dashboard(c: DashboardContext) {
  return <DashboardScreen services={c.services} active onAdd={c.onAdd}
    onManage={c.onManage} onOpenPet={c.onOpenPet} />;
}

async function paint(c: DashboardContext, children: ReactNode = dashboard(c), store: ReplicaStore = c.store) {
  return render(<ReplicaProvider store={store}>
    <AssetFilesProvider files={c.files}>{children}</AssetFilesProvider>
  </ReplicaProvider>);
}

function seedTask(c: DashboardContext, overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  const pet = c.seedPet();
  return c.seedTask({ pet_ids: [pet.id], times_of_day: [], ...overrides });
}

function cardId(task: TaskTemplate, date: string, time?: string): string {
  return `task-card-${task.id}-${date}${time === undefined ? '' : `T${time}`}`;
}

describe('ScopeFilter', () => {
  test('R6.11 renders nothing for a member', async () => {
    const c = await scene('member');
    const viewer = c.store.getState().members[c.sessionUser.id];
    if (viewer === undefined) throw new Error('The seeded viewer is missing');
    const onChange = jest.fn();
    await paint(c, <ScopeFilter viewer={viewer} members={Object.values(c.store.getState().members)}
      value="mine" active onChange={onChange} />);
    expect(screen.queryByTestId('scope-filter')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  test.each(['all', 'user'] as const)(
    'R6.10 R6.11 defaults to mine for a leader and persists the %s choice', async (choice) => {
      const c = await scene();
      const mine = seedTask(c, { title: 'My task', assigned_to: c.sessionUser.id });
      const unassigned = seedTask(c, { title: 'Shared task', assigned_to: null });
      const other = seedTask(c, { title: 'Other task', assigned_to: c.other.id });
      const disabled = c.factory.members({ disabled_at: new Date(c.clock.now()).toISOString() });
      c.driver.transaction(() => { c.apply.applyLocalRow('members', disabled); });
      const mounted = await paint(c);
      expect(screen.getByTestId('scope-mine')).toBeSelected();
      expect(screen.queryByTestId(`scope-user-${c.sessionUser.id}`)).toBeNull();
      expect(screen.queryByTestId(`scope-user-${disabled.id}`)).toBeNull();
      expect(screen.getByTestId(cardId(mine, today(c)))).toBeOnTheScreen();
      expect(screen.getByTestId(cardId(unassigned, today(c)))).toBeOnTheScreen();
      expect(screen.queryByTestId(cardId(other, today(c)))).toBeNull();

      const chip = choice === 'all' ? 'scope-all' : `scope-user-${c.other.id}`;
      await fireEvent.press(screen.getByTestId(chip));
      expect(screen.getByTestId(chip)).toBeSelected();
      expect(screen.getByTestId(cardId(other, today(c)))).toBeOnTheScreen();
      for (const task of [mine, unassigned]) {
        if (choice === 'all') expect(screen.getByTestId(cardId(task, today(c)))).toBeOnTheScreen();
        else expect(screen.queryByTestId(cardId(task, today(c)))).toBeNull();
      }
      expect(c.kv.get('scope_filter')).not.toBeNull();
      await mounted.unmount();
      await paint(c);
      expect(screen.getByTestId(chip)).toBeSelected();
      expect(screen.getByTestId(cardId(other, today(c)))).toBeOnTheScreen();

      await fireEvent.press(screen.getByTestId('scope-mine'));
      await cleanup();
      await paint(c);
      expect(screen.getByTestId('scope-mine')).toBeSelected();
      expect(screen.getByTestId(cardId(mine, today(c)))).toBeOnTheScreen();
      expect(screen.getByTestId(cardId(unassigned, today(c)))).toBeOnTheScreen();
      expect(screen.queryByTestId(cardId(other, today(c)))).toBeNull();
    },
  );
});

test('R6.11 a member has no scope control and sees only their own and unassigned tasks', async () => {
  const c = await scene('member');
  const mine = seedTask(c, { assigned_to: c.sessionUser.id });
  const shared = seedTask(c);
  const other = seedTask(c, { assigned_to: c.other.id });
  await paint(c);
  expect(screen.queryByTestId('scope-filter')).toBeNull();
  expect(screen.getByTestId(cardId(mine, today(c)))).toBeOnTheScreen();
  expect(screen.getByTestId(cardId(shared, today(c)))).toBeOnTheScreen();
  expect(screen.queryByTestId(cardId(other, today(c)))).toBeNull();
});

test.each([
  ['overdue', '07:00'], ['now', '22:30'], ['later', '23:59'], ['done', '08:00'],
] as const)('R6.3 renders only the nonempty %s section', async (group, time) => {
  const c = await scene();
  const task = seedTask(c, { times_of_day: [time] });
  const date = today(c);
  if (group === 'done') c.seedCompletion(task, { occurrence_key: `${date}T${time}` });
  const planned = selectDayView(c.store.getState(), {
    date, now: c.clock.now(), me: c.sessionUser.id, scope: 'mine',
  });
  expect(planned[group]).toHaveLength(1);
  await paint(c);
  for (const section of ['overdue', 'now', 'later', 'done']) {
    if (section === group) expect(screen.getByTestId(`section-${section}`)).toBeOnTheScreen();
    else expect(screen.queryByTestId(`section-${section}`)).toBeNull();
  }
  if (group === 'done') {
    expect(screen.getByTestId('section-done')).toBeCollapsed();
    expect(screen.queryByTestId(cardId(task, date, time))).toBeNull();
    await fireEvent.press(screen.getByTestId('section-done'));
  }
  expect(screen.getByTestId(cardId(task, date, time))).toBeOnTheScreen();
});

test('R6.3 omits every task section when the ready replica has no occurrences in scope', async () => {
  const c = await scene();
  seedTask(c, { assigned_to: c.other.id });
  await paint(c);
  for (const group of ['overdue', 'now', 'later', 'done']) {
    expect(screen.queryByTestId(`section-${group}`)).toBeNull();
  }
  expect(screen.queryAllByTestId(/^task-card-/)).toHaveLength(0);
  expect(screen.queryAllByTestId(/^dashboard-skeleton-/)).toHaveLength(0);
  expect(screen.getByTestId('task-add')).toBeOnTheScreen();
});

test.each(['not ready', 'empty before first pull'] as const)(
  'R6.1 shows five skeletons while the replica is %s', async (state) => {
    const c = await scene();
    const store = state === 'not ready' ? createReplicaStore() : c.store;
    if (state === 'empty before first pull') {
      const family = c.store.getState().family;
      if (family === null) throw new Error('The seeded family is missing');
      c.driver.transaction(() => { c.apply.removeRow('family', family.id); });
    }
    await paint(c, dashboard(c), store);
    expect(screen.getAllByTestId(/^dashboard-skeleton-/)).toHaveLength(5);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryAllByTestId(/^task-card-/)).toHaveLength(0);
    expect(c.marker.dashboardInteractive).not.toHaveBeenCalled();
  },
);

test.each([-90, 30])('R6.2 DayHeader stops at the inclusive %i-day limit', async (offset) => {
  const c = await scene();
  const date = addDays(today(c), offset);
  const onChange = jest.fn();
  await paint(c, <DayHeader date={date} today={today(c)} active onChange={onChange} />);
  const outward = offset < 0 ? 'day-prev' : 'day-next';
  const inward = offset < 0 ? 'day-next' : 'day-prev';
  expect(screen.getByTestId(outward)).toBeDisabled();
  expect(screen.getByTestId(inward)).toBeEnabled();
  await fireEvent.press(screen.getByTestId(outward));
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId(inward));
  expect(onChange).toHaveBeenLastCalledWith(addDays(date, offset < 0 ? 1 : -1));
  await fireEvent.press(screen.getByTestId('day-today'));
  expect(onChange).toHaveBeenLastCalledWith(today(c));
});

test('R6.2 opens on the family-local today and returns there from another day', async () => {
  const c = await scene();
  // The injected instant is October 14 in UTC and October 13 for the family.
  expect(today(c)).toBe('2026-10-13');
  const task = seedTask(c);
  await paint(c);
  expect(screen.getByTestId(cardId(task, today(c)))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('day-prev'));
  expect(screen.getByTestId(cardId(task, addDays(today(c), -1)))).toBeOnTheScreen();
  expect(screen.queryByTestId(cardId(task, today(c)))).toBeNull();
  await fireEvent.press(screen.getByTestId('day-today'));
  expect(screen.getByTestId(cardId(task, today(c)))).toBeOnTheScreen();
  await cleanup();
  await paint(c);
  expect(screen.getByTestId(cardId(task, today(c)))).toBeOnTheScreen();
});

test('R6.4 a future day puts all-day and timed occurrences under later', async () => {
  const c = await scene();
  const allDay = seedTask(c);
  const timed = seedTask(c, { times_of_day: ['07:00', '22:30', '23:59'] });
  await paint(c);
  await fireEvent.press(screen.getByTestId('day-next'));
  const date = addDays(today(c), 1);
  for (const group of ['overdue', 'now', 'done']) {
    expect(screen.queryByTestId(`section-${group}`)).toBeNull();
  }
  expect(screen.getByTestId('section-later')).toBeOnTheScreen();
  expect(screen.getByTestId(cardId(allDay, date))).toBeOnTheScreen();
  for (const time of timed.times_of_day) {
    expect(screen.getByTestId(cardId(timed, date, time))).toBeOnTheScreen();
  }
  expect(screen.getAllByTestId(/^task-card-/)).toHaveLength(4);
  // Cards are static in P5-2; if they expose checkboxes, future ones must be disabled.
  for (const checkbox of screen.queryAllByRole('checkbox')) expect(checkbox).toBeDisabled();
});

test('R6.4 regrouping follows the injected clock on a minute tick', async () => {
  const c = await scene();
  const task = seedTask(c, { times_of_day: ['22:30'] });
  await paint(c);
  expect(screen.getByTestId('section-now')).toBeOnTheScreen();
  c.clock.advance(61 * 60_000);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByTestId('section-now')).toBeNull();
  expect(screen.getByTestId('section-overdue')).toBeOnTheScreen();
  expect(screen.getByTestId(cardId(task, today(c), '22:30'))).toBeOnTheScreen();
});

test('R6.14 pull-to-refresh kicks the engine and keeps the list while the pull is pending', async () => {
  const c = await scene();
  const task = seedTask(c);
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  c.refresh.mockReturnValue(pending);
  await paint(c);
  const id = cardId(task, today(c));
  const before = c.store.getState().taskTemplates;
  expect(screen.getByTestId(id)).toBeOnTheScreen();
  const onRefresh = screen.getByTestId('dashboard-refresh').props.onRefresh as () => void;
  // Keep an async refresh handler pending while observing the rendered list.
  await act(() => { onRefresh(); });
  expect(c.refresh).toHaveBeenCalledWith('refresh');
  expect(c.refresh.mock.calls.filter(([reason]) => reason === 'refresh')).toHaveLength(1);
  expect(screen.getByTestId(id)).toBeOnTheScreen();
  expect(screen.queryAllByTestId(/^dashboard-skeleton-/)).toHaveLength(0);
  expect(c.store.getState().taskTemplates).toBe(before);
  await act(async () => { finish?.(); await pending; });
  expect(screen.getByTestId(id)).toBeOnTheScreen();
  expect(c.store.getState().taskTemplates).toBe(before);
});

test('R2.11 R6.3 upcoming care includes overdue through seven days and opens the pet', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const archived = c.seedPet({ archived_at: new Date(c.clock.now()).toISOString() });
  const visible = [-9, 0, 3, 7].map((days) => c.factory.health_events({
    pet_id: pet.id, title: `Care ${days}`, next_due_on: addDays(today(c), days),
  }));
  const hidden = [
    c.factory.health_events({ pet_id: pet.id, next_due_on: addDays(today(c), 8) }),
    c.factory.health_events({ pet_id: archived.id, next_due_on: today(c) }),
    c.factory.health_events({ pet_id: pet.id, next_due_on: null }),
    c.factory.health_events({ pet_id: pet.id, next_due_on: today(c), deleted_at: new Date(c.clock.now()).toISOString() }),
  ];
  c.driver.transaction(() => {
    for (const event of [...visible, ...hidden]) c.apply.applyLocalRow('health_events', event);
  });
  await paint(c);
  expect(screen.getByTestId('section-care')).toBeOnTheScreen();
  expect(screen.getAllByTestId(/^care-event-/).map((row) => row.props.testID))
    .toEqual(visible.map((event) => `care-event-${event.id}`));
  for (const [index, days] of [-9, 0, 3, 7].entries()) {
    const event = visible[index];
    if (event === undefined) throw new Error('The seeded care event is missing');
    const row = screen.getByTestId(`care-event-${event.id}`);
    expect(within(row).getByText(event.title)).toBeOnTheScreen();
    expect(within(row).getByText(formatCareDue(days))).toBeOnTheScreen();
    await fireEvent.press(row);
    expect(c.onOpenPet).toHaveBeenLastCalledWith(pet.id);
  }
  await fireEvent.press(screen.getByTestId('day-next'));
  expect(screen.queryByTestId('section-care')).toBeNull();
  await fireEvent.press(screen.getByTestId('day-today'));
  expect(screen.getByTestId('section-care')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('day-prev'));
  expect(screen.queryByTestId('section-care')).toBeNull();
});

test('R6.3 hides an empty care section and the ready empty state offers task creation', async () => {
  const c = await scene();
  await paint(c);
  expect(screen.queryByTestId('section-care')).toBeNull();
  expect(screen.getByRole('header', { name: strings.dashboard.emptyTitle })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: strings.dashboard.createTask }));
  expect(c.onAdd).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('task-add'));
  expect(c.onAdd).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByTestId('tasks-manage'));
  expect(c.onManage).toHaveBeenCalledTimes(1);
});

test.each(['all', 'user'] as const)(
  'R6.11 a member ignores the stored leader scope %s and sees only their own and unassigned tasks', async (choice) => {
    const c = await scene('member');
    c.kv.set('scope_filter', choice === 'all' ? 'all' : `user:${c.other.id}`);
    const mine = seedTask(c, { assigned_to: c.sessionUser.id });
    const shared = seedTask(c, { assigned_to: null });
    const other = seedTask(c, { assigned_to: c.other.id });
    await paint(c);
    expect(screen.queryByTestId(cardId(other, today(c)))).toBeNull();
    expect(screen.getByTestId(cardId(mine, today(c)))).toBeOnTheScreen();
    expect(screen.getByTestId(cardId(shared, today(c)))).toBeOnTheScreen();
  },
);

test('R6.2 clamps the selected day to the new minus-90 limit after family midnight', async () => {
  const c = await scene();
  const initialToday = today(c);
  await paint(c);
  for (let daysBack = 0; daysBack < 90; daysBack += 1) {
    expect(screen.getByTestId('day-prev')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('day-prev'));
  }
  const initialLimit = formatDashboardDay(addDays(initialToday, -90), initialToday);
  expect(within(screen.getByTestId('day-today')).getByText(initialLimit)).toBeOnTheScreen();
  expect(screen.getByTestId('day-prev')).toBeDisabled();

  c.clock.advance(Date.parse('2026-10-14T03:00:01Z') - c.clock.now());
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });

  expect(today(c)).toBe(addDays(initialToday, 1));
  const newLimit = formatDashboardDay(addDays(today(c), -90), today(c));
  expect(within(screen.getByTestId('day-today')).getByText(newLimit)).toBeOnTheScreen();
  expect(screen.queryByText(initialLimit)).toBeNull();
  expect(screen.getByTestId('day-prev')).toBeDisabled();
});
