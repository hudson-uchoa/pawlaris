import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState, StyleSheet, processColor, useColorScheme, type AppStateStatus, type ViewStyle } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { strings } from '../../../i18n/strings';
import type { ConnectionObservable, ConnectionState } from '../../../sync/engine';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { dark, light } from '../../../ui/tokens/color';
import { SyncIndicator } from '../SyncIndicator';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);
const initialAppState = AppState.currentState;
type RenderedView = Awaited<ReturnType<typeof render>>;

function connection(initial: ConnectionState) {
  let state = initial;
  const listeners = new Set<(state: ConnectionState) => void>();
  return {
    getState: () => state,
    subscribe(listener: (state: ConnectionState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: ConnectionState) { state = next; listeners.forEach((listener) => listener(state)); },
    listeners,
  } satisfies ConnectionObservable & {
    set(next: ConnectionState): void;
    listeners: Set<(state: ConnectionState) => void>;
  };
}

function drawing(view: RenderedView) {
  return view.container.queryAll((node) => node.props.d !== undefined || node.props.r !== undefined)
    .map((node) => ({ d: node.props.d, r: node.props.r, cx: node.props.cx, cy: node.props.cy,
      fill: node.props.fill, stroke: node.props.stroke, strokeWidth: node.props.strokeWidth }));
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
  jest.mocked(useColorScheme).mockReturnValue('dark');
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

describe.each(['light', 'dark'] as const)('R5.6 SyncIndicator in %s', (scheme) => {
  beforeEach(() => { jest.mocked(useColorScheme).mockReturnValue(scheme); });

  test.each([
    ['synced', 0, strings.sync.synced],
    ['syncing', 0, strings.sync.syncing],
    ['syncing', 3, `${strings.sync.syncing} (3)`],
    ['offline', 3, strings.sync.offline],
  ] as const)('shows %s with %s queued using the correct drawing and text', async (status, outboxCount, label) => {
    const color = scheme === 'light' ? light : dark;
    const state = connection({ status, outboxCount, server: 'primary' });
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const view = await render(<SyncIndicator connection={state} active />);
    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toBeOnTheScreen();
    expect(indicator.props.accessibilityLabel).toBe(label);
    expect(screen.getByText(label)).toBeOnTheScreen();
    const artwork = drawing(view);
    expect(artwork.length).toBeGreaterThan(0);
    if (status === 'synced') {
      expect(artwork).toEqual(expect.arrayContaining([expect.objectContaining({
        fill: { type: 0, payload: processColor(color.success) },
      })]));
      expect(artwork.some((node) => typeof node.d === 'string' && (node.d.match(/Q/g) ?? []).length === 4)).toBe(true);
      expect(repeat).not.toHaveBeenCalled();
    } else if (status === 'offline') {
      expect(artwork).toEqual(expect.arrayContaining([expect.objectContaining({
        fill: { type: 0, payload: processColor(color.textMuted) },
      })]));
      expect(screen.getByText(label)).toHaveStyle({ color: color.textMuted });
      expect(view.container.queryAll((node) => StyleSheet.flatten<ViewStyle>(node.props.style)?.backgroundColor === color.danger))
        .toHaveLength(0);
      expect(artwork.every((node) => node.fill?.payload !== processColor(color.danger)
        && node.stroke?.payload !== processColor(color.danger))).toBe(true);
      expect(artwork.some((node) => typeof node.d === 'string' && (node.d.match(/A/g) ?? []).length === 2)).toBe(true);
      expect(repeat).not.toHaveBeenCalled();
    } else {
      expect(artwork.some((node) => 2 * Number(node.r) + Number(node.strokeWidth) === 14)).toBe(true);
      expect(screen.getByTestId('sync-indicator-dot', { includeHiddenElements: true })).toBeOnTheScreen();
    }
  });

  test.each([['synced', 0], ['syncing', 0], ['syncing', 2]] as const)('RS-8 %s with %s queued on reserve changes only the label', async (status, outboxCount) => {
    const state = connection({ status, outboxCount, server: 'primary' });
    const view = await render(<SyncIndicator connection={state} active={false} />);
    const before = drawing(view);
    const dotBefore = status === 'syncing'
      ? getAnimatedStyle(screen.getByTestId('sync-indicator-dot', { includeHiddenElements: true })) : null;
    const label = status === 'syncing'
      ? `${strings.sync.syncing}${outboxCount === 0 ? '' : ` (${outboxCount})`}` : strings.sync.synced;
    await act(() => { state.set({ ...state.getState(), server: 'reserve' }); });
    expect(screen.getByText(`${label}${strings.sync.reserveSuffix}`)).toBeOnTheScreen();
    expect(drawing(view)).toEqual(before);
    if (status === 'syncing') {
      expect(getAnimatedStyle(screen.getByTestId('sync-indicator-dot', { includeHiddenElements: true }))).toEqual(dotBefore);
    }
    expect(screen.queryByText(label)).toBeNull();
  });

  test('offline on reserve has no suffix', async () => {
    await render(<SyncIndicator connection={connection({ status: 'offline', server: 'reserve', outboxCount: 1 })} active />);
    expect(screen.getByText(strings.sync.offline)).toBeOnTheScreen();
    expect(screen.queryByText(`${strings.sync.offline}${strings.sync.reserveSuffix}`)).toBeNull();
  });
});

test('R5.6 subscribes to connection changes and unsubscribes on unmount', async () => {
  const state = connection({ status: 'synced', server: 'primary', outboxCount: 0 });
  const view = await render(<SyncIndicator connection={state} active={false} />);
  await act(() => { state.set({ status: 'syncing', server: 'primary', outboxCount: 4 }); });
  expect(screen.getByText(`${strings.sync.syncing} (4)`)).toBeOnTheScreen();
  await act(() => { state.set({ status: 'offline', server: 'primary', outboxCount: 4 }); });
  expect(screen.getByText(strings.sync.offline)).toBeOnTheScreen();
  await view.unmount();
  expect(state.listeners.size).toBe(0);
});

test('SyncIndicator hides when signed out', async () => {
  await render(<SyncIndicator connection={connection({ status: 'signed_out', server: 'primary', outboxCount: 0 })} active />);
  expect(screen.queryByTestId('sync-indicator')).toBeNull();
});

test('SyncIndicator orbits once in 1200 ms while syncing and cancels when synced', async () => {
  const timing = jest.spyOn(timingAnimation, 'withTiming');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const state = connection({ status: 'syncing', server: 'primary', outboxCount: 1 });
  await render(<SyncIndicator connection={state} active />);
  expect(timing).toHaveBeenCalledWith(2 * Math.PI, expect.objectContaining({ duration: 1200 }));
  expect(repeat).toHaveBeenCalledTimes(1);
  const dot = screen.getByTestId('sync-indicator-dot', { includeHiddenElements: true });
  const initial = getAnimatedStyle(dot);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(getAnimatedStyle(dot)).not.toEqual(initial);
  await act(() => { state.set({ status: 'synced', server: 'primary', outboxCount: 0 }); });
  expect(cancel).toHaveBeenCalled();
  expect(screen.queryByTestId('sync-indicator-dot', { includeHiddenElements: true })).toBeNull();
});

test('MO-3 SyncIndicator starts no repeat under Reduce Motion and keeps a static dot', async () => {
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  await render(<SyncIndicator connection={connection({ status: 'syncing', server: 'primary', outboxCount: 2 })} active />);
  const dot = screen.getByTestId('sync-indicator-dot', { includeHiddenElements: true });
  const initial = getAnimatedStyle(dot);
  await act(async () => { await jest.advanceTimersByTimeAsync(2400); });
  expect(getAnimatedStyle(dot)).toEqual(initial);
  expect(repeat).not.toHaveBeenCalled();
});

test.each(['focus', 'background'] as const)('P6 SyncIndicator cancels its orbit on loss of %s', async (reason) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const notify = (state: AppStateStatus) => { (listener as (value: AppStateStatus) => void)(state); };
    listeners.add(notify);
    return { remove: () => { listeners.delete(notify); } };
  });
  const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
  const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
  const state = connection({ status: 'syncing', server: 'primary', outboxCount: 2 });
  const view = await render(<SyncIndicator connection={state} active />);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  cancel.mockClear();
  repeat.mockClear();
  if (reason === 'background') {
    await act(() => { AppState.currentState = 'background'; listeners.forEach((notify) => notify('background')); });
  } else {
    await view.rerender(<SyncIndicator connection={state} active={false} />);
  }
  expect(cancel).toHaveBeenCalled();
  const dot = screen.getByTestId('sync-indicator-dot', { includeHiddenElements: true });
  const initial = getAnimatedStyle(dot);
  await act(async () => { await jest.advanceTimersByTimeAsync(2400); });
  expect(getAnimatedStyle(dot)).toEqual(initial);
  expect(repeat).not.toHaveBeenCalled();
});
