import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { formatCompletionLost } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { replicaContext, type ReplicaContext } from '../../../replica/__tests__/support';
import { ReplicaProvider } from '../../../replica/useReplica';
import { createSyncEvents } from '../../../sync/events';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { ToastProvider } from '../../../ui/primitives/Toast';
import { SyncToastHost } from '../SyncToastHost';

const initialAppState = AppState.currentState;
let context: ReplicaContext;

beforeEach(async () => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  context = await replicaContext();
  context.clock.advance(Date.UTC(2026, 9, 16, 10, 12) - context.clock.now());
});

afterEach(async () => {
  await cleanup();
  context.driver.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

async function scene() {
  const { factory, store, apply } = context;
  const member = factory.members({ display_name: 'Duda' });
  const winner = factory.task_completions({ completed_by: member.id });
  apply.applyServerRows([
    { entity: 'family', row: factory.family() },
    { entity: 'members', row: member },
    { entity: 'task_completions', row: winner },
  ]);
  const events = createSyncEvents();
  const view = await render(<ReplicaProvider store={store}>
    <ToastProvider dismissLabel={strings.dismiss}><SyncToastHost events={events} active /></ToastProvider>
  </ReplicaProvider>);
  return { view, store, factory, events, member, winner };
}

test('R3.21 completion_lost politely announces the winner in family time and leaves the completion lit', async () => {
  const c = await scene();
  const before = c.store.getState().completions;
  expect(screen.queryByRole('alert')).toBeNull();
  await act(() => { c.events.emit('completion_lost', { winner: c.winner }); });
  const expected = formatCompletionLost(c.member.display_name, Date.parse(c.winner.completed_at), 'America/Sao_Paulo');
  const notice = screen.getByRole('alert', { name: expected });
  expect(notice.props.accessibilityLiveRegion).toBe('polite');
  expect(c.store.getState().completions).toEqual(before);
  expect(c.store.getState().completions[c.winner.id]?.undone_at).toBeNull();
  expect(screen.getByRole('button', { name: strings.dismiss })).toBeOnTheScreen();
});

test('OB-2 mutation_rejected shows the standard toast and unsubscribes on unmount', async () => {
  const c = await scene();
  const entry = { ...c.factory.outbox(), seq: 1, attempts: 0, serverErrors: 0, nextRetryAt: 0, lastError: null };
  await act(() => { c.events.emit('mutation_rejected', { entry }); });
  expect(screen.getByRole('alert')).toHaveTextContent(strings.toasts.mutationRejected);
  await c.view.unmount();
  await act(() => { c.events.emit('mutation_rejected', { entry }); });
  expect(screen.queryByRole('alert')).toBeNull();
});
