import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { fakeClock } from '../../../testing/fakeClock';
import { useNow } from '../useNow';

const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0, doNotFake: ['queueMicrotask', 'nextTick'] });
  AppState.currentState = 'active';
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

test('R6.4 useNow aligns minute ticks to the injected clock and stops on blur', async () => {
  const clock = fakeClock(Date.parse('2026-10-13T15:00:10Z'));
  const initial = clock.now();
  const hook = await renderHook(({ active }: { active: boolean }) => useNow(clock, 60_000, active),
    { initialProps: { active: true } });
  expect(hook.result.current).toBe(initial);
  expect(jest.getTimerCount()).toBe(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(49_999); });
  expect(hook.result.current).toBe(initial);
  clock.advance(50_000);
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(hook.result.current).toBe(clock.now());
  await hook.rerender({ active: false });
  expect(jest.getTimerCount()).toBe(0);
  const blurred = hook.result.current;
  clock.advance(5 * 60_000);
  await act(async () => { await jest.advanceTimersByTimeAsync(5 * 60_000); });
  expect(hook.result.current).toBe(blurred);
  await hook.rerender({ active: true });
  expect(hook.result.current).toBe(clock.now());
  expect(jest.getTimerCount()).toBe(1);
  await hook.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

test('R6.4 useNow has no background timer and refreshes immediately on foreground', async () => {
  const clock = fakeClock(Date.parse('2026-10-13T15:00:00Z'));
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
  const hook = await renderHook(() => useNow(clock, 60_000));
  expect(jest.getTimerCount()).toBe(1);
  await act(() => {
    AppState.currentState = 'background';
    for (const listener of listeners) listener('background');
  });
  expect(jest.getTimerCount()).toBe(0);
  clock.advance(3 * 60_000);
  await act(() => {
    AppState.currentState = 'active';
    for (const listener of listeners) listener('active');
  });
  expect(hook.result.current).toBe(clock.now());
  expect(jest.getTimerCount()).toBe(1);
  await hook.unmount();
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
