import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Bell } from 'lucide-react-native';
import { StyleSheet, useColorScheme, type Insets, type ViewStyle } from 'react-native';
import { State, type PanGesture } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import * as ReduceMotion from '../motion/useReduceMotion';
import { Avatar } from '../primitives/Avatar';
import { Button } from '../primitives/Button';
import { Card } from '../primitives/Card';
import { Chip } from '../primitives/Chip';
import { EmptyState } from '../primitives/EmptyState';
import { Icon } from '../primitives/Icon';
import { PressableScale } from '../primitives/PressableScale';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { Sheet } from '../primitives/Sheet';
import { Skeleton } from '../primitives/Skeleton';
import { Switch } from '../primitives/Switch';
import { Text } from '../primitives/Text';
import { TextField } from '../primitives/TextField';
import { Toast, ToastHost, ToastProvider, useToast } from '../primitives/Toast';
import { dark, light } from '../tokens/color';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
// Barrel re-exports are non-configurable. Spy on their original exports,
// retaining Reanimated's real Jest implementation and animation behaviour.
const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>('react-native-reanimated/src/animation/repeat');
const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>('react-native-reanimated/src/animation/spring/spring');
const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>('react-native-reanimated/src/animation/timing');
const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>('react-native-reanimated/src/animation/util');

function expectTouchTarget(element: ReturnType<typeof screen.getByRole>): void {
  const style = StyleSheet.flatten<ViewStyle>(element.props.style) ?? {};
  const slop = element.props.hitSlop as Insets | number | undefined;
  const sides = typeof slop === 'number'
    ? { top: slop, right: slop, bottom: slop, left: slop } : slop;
  const dimension = (minimum: unknown, size: unknown) =>
    Math.max(typeof minimum === 'number' ? minimum : 0, typeof size === 'number' ? size : 0);
  expect(dimension(style.minWidth, style.width) + (sides?.left ?? 0) + (sides?.right ?? 0))
    .toBeGreaterThanOrEqual(44);
  expect(dimension(style.minHeight, style.height) + (sides?.top ?? 0) + (sides?.bottom ?? 0))
    .toBeGreaterThanOrEqual(44);
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each(['light', 'dark'] as const)('P4-1 primitives in %s', (scheme) => {
  const color = scheme === 'light' ? light : dark;
  beforeEach(() => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(false);
  });

  test('PressableScale renders a labelled button, commits on release and honours disabled', async () => {
    const onPress = jest.fn();
    const view = await render(<PressableScale accessibilityLabel="Record care" onPress={onPress}><Text>Care</Text></PressableScale>);
    const button = screen.getByRole('button', { name: 'Record care' });
    expectTouchTarget(button);
    await fireEvent(button, 'pressIn');
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent(button, 'pressOut');
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<PressableScale accessibilityLabel="Record care" onPress={onPress} disabled><Text>Care</Text></PressableScale>);
    expect(screen.getByRole('button', { name: 'Record care' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Record care' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('Card renders themed content and a labelled press action that can be disabled', async () => {
    const onPress = jest.fn();
    const view = await render(<Card accessibilityLabel="Open pet" onPress={onPress}><Text>Pet details</Text></Card>);
    expect(screen.getByText('Pet details')).toBeOnTheScreen();
    const card = screen.getByRole('button', { name: 'Open pet' });
    expect(card).toHaveStyle({ backgroundColor: color.surface, borderColor: color.border, borderWidth: 1, borderRadius: 20, elevation: 2 });
    expectTouchTarget(card);
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<Card accessibilityLabel="Open pet" onPress={onPress} disabled><Text>Pet details</Text></Card>);
    expect(screen.getByRole('button', { name: 'Open pet' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Open pet' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('Avatar renders a labelled species placeholder and a local photo', async () => {
    const view = await render(<Avatar petId="pet-a" species="cat" accessibilityLabel="Pet portrait" size={48} />);
    expect(screen.getByRole('image', { name: 'Pet portrait' })).toBeOnTheScreen();
    await view.rerender(<Avatar petId="pet-a" species="cat" accessibilityLabel="Pet portrait" uri="file:///avatar.jpg" size={48} />);
    expect(screen.getByRole('image', { name: 'Pet portrait' })).toBeOnTheScreen();
    const photos = view.container.queryAll((node) => node.props.source?.uri === 'file:///avatar.jpg');
    expect(photos).toHaveLength(1);
    expect(photos[0]?.props.source).toEqual({ uri: 'file:///avatar.jpg' });
  });

  test('Chip renders selected state, a labelled action and disabled behaviour', async () => {
    const onPress = jest.fn();
    const view = await render(<Chip label="Cats" accessibilityLabel="Filter cats" onPress={onPress} selected />);
    const chip = screen.getByRole('button', { name: 'Filter cats', selected: true });
    expect(screen.getByText('Cats')).toBeOnTheScreen();
    expectTouchTarget(chip);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<Chip label="Cats" accessibilityLabel="Filter cats" onPress={onPress} disabled />);
    expect(screen.getByRole('button', { name: 'Filter cats', selected: false })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Filter cats' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('Skeleton renders final geometry with no accessibility or press target', async () => {
    const view = await render(<Skeleton width={240} height={48} active testID="loading-shape" />);
    expect(screen.getByTestId('loading-shape', { includeHiddenElements: true })).toHaveStyle({ width: 240, height: 48 });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.getByTestId('loading-shape', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
    await view.rerender(<Skeleton width={240} height={48} active={false} testID="loading-shape" />);
    expect(screen.getByTestId('loading-shape', { includeHiddenElements: true })).toHaveStyle({ width: 240, height: 48 });
  });

  test('Sheet exposes a labelled dialog, dismisses by action and hides when closed', async () => {
    const onDismiss = jest.fn();
    const view = await render(<Sheet visible accessibilityLabel="Confirm care" dismissLabel="Close sheet" onDismiss={onDismiss}><Text>Confirm details</Text></Sheet>);
    expect(screen.getByRole('dialog', { name: 'Confirm care' })).toBeOnTheScreen();
    expect(screen.getByText('Confirm details')).toBeOnTheScreen();
    const dismiss = screen.getByRole('button', { name: 'Close sheet' });
    expectTouchTarget(dismiss);
    await fireEvent.press(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await view.rerender(<Sheet visible={false} accessibilityLabel="Confirm care" dismissLabel="Close sheet" onDismiss={onDismiss}><Text>Confirm details</Text></Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Confirm details')).toBeNull();
  });

  test('Toast announces its message and supplies a labelled dismiss action', async () => {
    const onDismiss = jest.fn();
    await render(<Toast message="Care saved" dismissLabel="Dismiss notice" onDismiss={onDismiss} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Care saved');
    const dismiss = screen.getByRole('button', { name: 'Dismiss notice' });
    expectTouchTarget(dismiss);
    await fireEvent.press(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Toast host displays a requested notice and removes it on dismissal', async () => {
    function NoticeTrigger() {
      const toast = useToast();
      return <Button label="Show notice" accessibilityLabel="Show notice" onPress={() => toast.show('Care saved')} />;
    }
    await render(<ToastProvider dismissLabel="Dismiss notice"><NoticeTrigger /><ToastHost /></ToastProvider>);
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Show notice' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Care saved');
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('EmptyState renders supplied content and a labelled action that can be disabled', async () => {
    const onPress = jest.fn();
    const view = await render(<EmptyState title="No entries" description="Create the first entry" action={{ label: 'Create entry', accessibilityLabel: 'Create entry', onPress }} />);
    expect(screen.getByRole('header')).toHaveTextContent('No entries');
    expect(screen.getByText('Create the first entry')).toBeOnTheScreen();
    expectTouchTarget(screen.getByRole('button', { name: 'Create entry' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create entry' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<EmptyState title="No entries" action={{ label: 'Create entry', accessibilityLabel: 'Create entry', onPress, disabled: true }} />);
    expect(screen.getByRole('button', { name: 'Create entry' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Create entry' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('Button renders its label, themed colour and disabled/loading behaviour', async () => {
    const onPress = jest.fn();
    const view = await render(<Button label="Save" accessibilityLabel="Save entry" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Save entry' });
    expect(screen.getByText('Save')).toBeOnTheScreen();
    expect(button).toHaveStyle({ backgroundColor: color.accent });
    expect(screen.getByText('Save')).toHaveStyle({ color: color.onAccent });
    expectTouchTarget(button);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<Button label="Save" accessibilityLabel="Save entry" onPress={onPress} disabled />);
    expect(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save entry' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<Button label="Save" accessibilityLabel="Save entry" onPress={onPress} loading />);
    expect(screen.getByRole('button', { name: 'Save entry', busy: true })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save entry' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('TextField renders label, error and accessible input and blocks disabled edits', async () => {
    const onChangeText = jest.fn();
    const view = await render(<TextField label="Name" accessibilityLabel="Pet name" value="A" onChangeText={onChangeText} error="Check the name" />);
    expect(screen.getByText('Name')).toBeOnTheScreen();
    expect(screen.getByText('Check the name')).toBeOnTheScreen();
    const input = screen.getByRole('textbox', { name: 'Pet name' });
    expect(input).toHaveDisplayValue('A');
    expectTouchTarget(input);
    await fireEvent.changeText(input, 'Aurora');
    expect(onChangeText).toHaveBeenLastCalledWith('Aurora');
    await view.rerender(<TextField label="Name" accessibilityLabel="Pet name" value="A" onChangeText={onChangeText} disabled />);
    expect(screen.getByRole('textbox', { name: 'Pet name' })).toBeDisabled();
    await fireEvent.changeText(screen.getByRole('textbox', { name: 'Pet name' }), 'Changed');
    expect(onChangeText).toHaveBeenCalledTimes(1);
  });

  test('Switch exposes its label and checked state and blocks disabled changes', async () => {
    const onValueChange = jest.fn();
    const view = await render(<Switch label="Require photo" accessibilityLabel="Require photo" value={false} onValueChange={onValueChange} />);
    const control = screen.getByRole('switch', { name: 'Require photo', checked: false });
    expectTouchTarget(control);
    await fireEvent.press(control);
    expect(onValueChange).toHaveBeenLastCalledWith(true);
    await view.rerender(<Switch label="Require photo" accessibilityLabel="Require photo" value onValueChange={onValueChange} disabled />);
    expect(screen.getByRole('switch', { name: 'Require photo', checked: true })).toBeDisabled();
    await fireEvent.press(screen.getByRole('switch', { name: 'Require photo' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  test('SegmentedControl labels the group, exposes selection and blocks disabled options', async () => {
    const onValueChange = jest.fn();
    const options = [{ value: 'active', label: 'Active' }, { value: 'ended', label: 'Ended' }, { value: 'locked', label: 'Locked', disabled: true }];
    const view = await render(<SegmentedControl accessibilityLabel="Task status" options={options} value="active" onValueChange={onValueChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Task status' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Active', checked: true })).toBeOnTheScreen();
    const ended = screen.getByRole('radio', { name: 'Ended', checked: false });
    expectTouchTarget(ended);
    await fireEvent.press(ended);
    expect(onValueChange).toHaveBeenLastCalledWith('ended');
    expect(screen.getByRole('radio', { name: 'Locked' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Locked' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    await view.rerender(<SegmentedControl accessibilityLabel="Task status" options={options} value="ended" onValueChange={onValueChange} disabled />);
    expect(screen.getByRole('radio', { name: 'Active' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Active' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  test('Icon labels meaningful artwork and hides decorative artwork from accessibility', async () => {
    const view = await render(<Icon glyph={Bell} accessibilityLabel="Reminder" color="textMuted" size={20} />);
    expect(screen.getByRole('image', { name: 'Reminder' })).toBeOnTheScreen();
    await view.rerender(<Icon glyph={Bell} testID="decorative-icon" size={24} />);
    expect(screen.getByTestId('decorative-icon', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole('image')).toBeNull();
  });

  test('Text renders content with the semantic colour and a 130 percent scale cap', async () => {
    await render(<Text color="textMuted" testID="body-copy">Details</Text>);
    const text = screen.getByText('Details');
    expect(text.props.maxFontSizeMultiplier).toBe(1.3);
    expect(text).toHaveStyle({ color: color.textMuted, fontFamily: 'Roboto', fontSize: 16, lineHeight: 22, fontWeight: '400' });
  });

  test.each([
    ['display', 'Space Grotesk', 32, 38, '700'],
    ['title', 'Space Grotesk', 24, 30, '700'],
    ['heading', 'Space Grotesk', 18, 24, '500'],
    ['body', 'Roboto', 16, 22, '400'],
    ['label', 'Roboto', 14, 18, '500'],
    ['caption', 'Roboto', 12, 16, '400'],
  ] as const)('Text %s uses the type scale of 06 section 2.3', async (variant, fontFamily, fontSize, lineHeight, fontWeight) => {
    await render(<Text variant={variant}>Type sample</Text>);
    const text = screen.getByText('Type sample');
    expect(text.props.maxFontSizeMultiplier).toBe(1.3);
    expect(text).toHaveStyle({ fontFamily, fontSize, lineHeight, fontWeight });
  });

  test.each([
    [300, 0, false], [310, 0, true], [10, 10000, true],
  ] as const)('Sheet drag %s with velocity %s dismisses: %s', async (translationY, velocityY, dismissed) => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    await render(<Sheet visible accessibilityLabel="Confirm care" dismissLabel="Close sheet" onDismiss={onDismiss} testID="confirmation-sheet"><Text>Details</Text></Sheet>);
    const dialog = screen.getByRole('dialog', { name: 'Confirm care' });
    await fireEvent(dialog, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 1000 } } });
    await act(async () => {
      fireGestureHandler<PanGesture>(getByGestureTestId('confirmation-sheet-pan'), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY, velocityY },
        { state: State.END, translationY, velocityY },
      ]);
      await jest.runAllTimersAsync();
    });
    expect(onDismiss).toHaveBeenCalledTimes(dismissed ? 1 : 0);
  });

  test('MO-3 Skeleton starts no repetition under Reduce Motion', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    await render(<Skeleton width={240} height={48} active testID="reduced-shape" />);
    expect(screen.getByTestId('reduced-shape', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(repeat).not.toHaveBeenCalled();
  });

  test('Skeleton starts no repetition while inactive and cancels it on loss of focus', async () => {
    jest.useFakeTimers();
    const repeat = jest.spyOn(repeatAnimation, 'withRepeat');
    const cancel = jest.spyOn(animationUtil, 'cancelAnimation');
    const view = await render(<Skeleton width={240} height={48} active={false} testID="inactive-shape" />);
    expect(screen.getByTestId('inactive-shape', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(repeat).not.toHaveBeenCalled();
    await view.rerender(<Skeleton width={240} height={48} active testID="inactive-shape" />);
    expect(repeat).toHaveBeenCalled();
    cancel.mockClear();
    await view.rerender(<Skeleton width={240} height={48} active={false} testID="inactive-shape" />);
    expect(cancel).toHaveBeenCalled();
    await act(() => { jest.advanceTimersByTime(1400); });
  });

  test('Sheet uses a 150 ms fade and schedules no spring under Reduce Motion', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const spring = jest.spyOn(springAnimation, 'withSpring');
    const timing = jest.spyOn(timingAnimation, 'withTiming');
    await render(<Sheet visible accessibilityLabel="Confirm care" dismissLabel="Close sheet" onDismiss={jest.fn()}><Text>Details</Text></Sheet>);
    expect(screen.getByRole('dialog', { name: 'Confirm care' })).toBeOnTheScreen();
    expect(spring).not.toHaveBeenCalled();
    expect(timing.mock.calls.some(([, config]) => config?.duration === 150)).toBe(true);
  });
});
