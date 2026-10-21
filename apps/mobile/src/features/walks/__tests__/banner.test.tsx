import { act, cleanup, render, screen } from '@testing-library/react-native';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import { historyContext, type HistoryContext } from '../../../walks/__tests__/historySupport';
import { DashboardScreen } from '../../dashboard/DashboardScreen';

let c: HistoryContext;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden'));
  c = await historyContext();
});

afterEach(async () => {
  await cleanup();
  c.dispose();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('R4.17 09 section 3.1 dashboard names the other walker and hides the banner after 12 hours', async () => {
  c.clock.advance(Date.parse('2026-10-21T21:03:00Z') - c.clock.now());
  const dog = c.seedPet({ name: 'Katarina', species: 'dog' });
  c.apply.applyServerRows([{ entity: 'members', row: { ...c.other, display_name: 'Hudson' } }]);
  c.seedWalk({ pet_id: dog.id, user_id: c.other.id, started_at: '2026-10-21T21:02:00Z' });
  await render(<ReplicaProvider store={c.store}>
    <DashboardScreen services={c.dashboardServices} active
      onAdd={c.onAdd} onManage={c.onManage} onOpenPet={c.onOpenPet} />
  </ReplicaProvider>);
  expect(screen.getByTestId('walk-banner')).toHaveTextContent(strings.walks.banner('Hudson', 'Katarina', '18:02'));
  await act(async () => {
    c.clock.advance(13 * 3_600_000);
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.queryByTestId('walk-banner')).toBeNull();
  expect(c.http.requests).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
