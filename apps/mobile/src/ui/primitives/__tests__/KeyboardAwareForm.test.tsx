import { createElement, useImperativeHandle, type ReactElement, type Ref } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { TextInput, type KeyboardAvoidingViewProps, type ViewProps } from 'react-native';
import { KeyboardAwareForm } from '../KeyboardAwareForm';
import { Button } from '../Button';

jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: jest.fn((props: KeyboardAvoidingViewProps) =>
    React.createElement(View, { ...props, testID: 'keyboard-avoidance-probe' })) };
});

const avoidingView = jest.requireMock<{
  default: jest.Mock<ReactElement, [KeyboardAvoidingViewProps]>;
}>('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView').default;

beforeEach(() => { jest.useFakeTimers({ now: 0 }); jest.clearAllMocks(); });
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('09 §1 the shared form enables built-in keyboard avoidance around its fields and primary action', async () => {
  await render(<KeyboardAwareForm keyboardVerticalOffset={24}>
    <TextInput testID="last-field" accessibilityLabel="Last field" />
    <Button label="Save" accessibilityLabel="Save" onPress={jest.fn()} active={false} />
  </KeyboardAwareForm>);
  expect(avoidingView).toHaveBeenCalledTimes(1);
  const props = avoidingView.mock.calls[0]?.[0];
  expect(props?.enabled).not.toBe(false);
  expect(['height', 'position', 'padding']).toContain(props?.behavior);
  expect(props?.keyboardVerticalOffset).toBe(24);
  const lifted = within(screen.getByTestId('keyboard-avoidance-probe'));
  expect(lifted.getByTestId('last-field')).toBeOnTheScreen();
  expect(lifted.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
});

test('09 §1 the shared form scrolls with handled keyboard taps and keeps its primary action operable', async () => {
  const save = jest.fn();
  const view = await render(<KeyboardAwareForm>
    <TextInput testID="last-field" accessibilityLabel="Last field" />
    <Button label="Save" accessibilityLabel="Save" onPress={save} active={false} />
  </KeyboardAwareForm>);
  const scrolls = view.container.queryAll((node) => node.props.keyboardShouldPersistTaps === 'handled');
  expect(scrolls.length).toBeGreaterThan(0);
  const scroll = scrolls[0];
  expect(scroll?.queryAll((node) => node.props.testID === 'last-field')).toHaveLength(1);
  expect(scroll?.queryAll((node) => node.props.accessibilityLabel === 'Save').length).toBeGreaterThan(0);
  await fireEvent(screen.getByTestId('last-field'), 'focus');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledTimes(1);
});

test('R3 / 09 §1 the shared form adds its measured window top to the supplied keyboard offset', async () => {
  const measureInWindow = jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => {
    callback(0, 56, 400, 700);
  });
  function MeasuredView({ ref, ...props }: ViewProps & { ref?: Ref<{ measureInWindow: typeof measureInWindow }> }) {
    useImperativeHandle(ref, () => ({ measureInWindow }));
    return createElement('View', props);
  }
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(native, 'View', 'get').mockReturnValue(MeasuredView as unknown as typeof native.View);
  const view = await render(<KeyboardAwareForm keyboardVerticalOffset={24}>
    <TextInput accessibilityLabel="Name" />
  </KeyboardAwareForm>);
  expect(screen.getByTestId('keyboard-avoidance-probe')).toHaveProp('keyboardVerticalOffset', 24);
  expect(measureInWindow).not.toHaveBeenCalled();
  const container = view.root;
  if (container === null) throw new Error('Missing form container');
  await fireEvent(container, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 700 } } });
  expect(measureInWindow).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('keyboard-avoidance-probe')).toHaveProp('keyboardVerticalOffset', 24 + 56);
});
