import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { ReplicaProvider } from '../../../replica/useReplica';
import { historyContext, type HistoryContext } from '../../../walks/__tests__/historySupport';
import { WalksScreen } from '../WalksScreen';
import { strings } from '../../../i18n/strings';

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

async function paint(): Promise<void> {
  await render(<ReplicaProvider store={c.store}>
    <WalksScreen services={c.services} active locationState="granted"
      onStart={c.onStart} onResume={c.onResume} onOpenWalk={c.onOpenWalk}
      onRequestLocation={c.onRequestLocation} onOpenSettings={c.onOpenSettings} />
  </ReplicaProvider>);
}

function expectNoRequest(): void {
  expect(c.http.requests).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

test('09 section 6.1 CTA with 0 dogs is hidden and shows the no-dog copy', async () => {
  c.seedPet({ species: 'cat' });
  c.seedPet({ species: 'dog', archived_at: new Date(c.clock.now()).toISOString() });
  await paint();
  expect(screen.getByText(strings.walks.noDogs)).toBeOnTheScreen();
  expect(screen.queryByTestId('walk-start')).toBeNull();
  expect(screen.queryByTestId('walk-resume')).toBeNull();
  expect(c.onStart).not.toHaveBeenCalled();
  expectNoRequest();
});

test('09 section 6.1 CTA with 1 dog names Katarina and starts that dog directly', async () => {
  const dog = c.seedPet({ name: 'Katarina', species: 'dog' });
  c.seedPet({ species: 'cat' });
  c.seedPet({ species: 'dog', archived_at: new Date(c.clock.now()).toISOString() });
  await paint();
  expect(screen.getByTestId('walk-start')).toHaveTextContent(strings.walks.startWithDog(dog.name));
  await fireEvent.press(screen.getByTestId('walk-start'));
  expect(c.onStart).toHaveBeenCalledTimes(1);
  expect(c.onStart).toHaveBeenCalledWith(dog.id);
  expectNoRequest();
});

test('09 section 6.1 CTA with 2 dogs opens a picker before starting the chosen dog', async () => {
  const first = c.seedPet({ name: 'Katarina', species: 'dog' });
  const second = c.seedPet({ name: 'Vega', species: 'dog' });
  const archived = c.seedPet({ name: 'Sirius', species: 'dog',
    archived_at: new Date(c.clock.now()).toISOString() });
  const cat = c.seedPet({ species: 'cat' });
  await paint();
  expect(screen.getByTestId('walk-start')).toHaveTextContent(strings.walks.start);
  await fireEvent.press(screen.getByTestId('walk-start'));
  expect(c.onStart).not.toHaveBeenCalled();
  expect(screen.getByText(first.name)).toBeOnTheScreen();
  expect(screen.getByText(second.name)).toBeOnTheScreen();
  expect(screen.queryByText(archived.name)).toBeNull();
  expect(screen.queryByText(cat.name)).toBeNull();
  await fireEvent.press(screen.getByText(second.name));
  expect(c.onStart).toHaveBeenCalledTimes(1);
  expect(c.onStart).toHaveBeenCalledWith(second.id);
  expectNoRequest();
});

test.each(['active', 'paused'] as const)(
  '09 section 6.1 resume replaces the CTA for a durable %s local walk', async (state) => {
    const dog = c.seedPet({ name: 'Katarina', species: 'dog' });
    const local = c.factory.localWalk({ petId: dog.id, state,
      pauseStartedAt: state === 'paused' ? c.clock.now() : null });
    c.walks.upsertLocal(local);
    await paint();
    expect(screen.getByTestId('walk-resume')).toHaveTextContent(strings.walks.resumeWalk);
    expect(screen.queryByTestId('walk-start')).toBeNull();
    await fireEvent.press(screen.getByTestId('walk-resume'));
    expect(c.onResume).toHaveBeenCalledTimes(1);
    expect(c.onStart).not.toHaveBeenCalled();
    expect(c.walks.getLocal()).toEqual(local);
    expectNoRequest();
  },
);

test.each(['leader', 'member'] as const)(
  'R4.17 R4.18 a 13-hour-old active walk of another member is interrupted for a %s', async (role) => {
    c.dispose();
    c = await historyContext(role);
    const dog = c.seedPet({ name: 'Katarina', species: 'dog' });
    const walk = c.seedWalk({ pet_id: dog.id, user_id: c.other.id,
      started_at: new Date(c.clock.now() - 13 * 3_600_000).toISOString() });
    await paint();
    const row = within(screen.getByTestId(`walk-row-${walk.id}`));
    expect(row.getByText(strings.walks.interrupted)).toBeOnTheScreen();
    expect(row.getByText(c.other.display_name, { exact: false })).toBeOnTheScreen();
    if (role === 'leader') {
      expect(row.getByText(strings.walks.discard)).toBeOnTheScreen();
    } else {
      expect(row.queryByText(strings.walks.discard)).toBeNull();
    }
    expect(c.store.getState().walks[walk.id]?.status).toBe('active');
    expectNoRequest();
  },
);
