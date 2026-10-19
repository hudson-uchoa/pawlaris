import type { TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatFullDate, formatValidationError } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { TaskFormScreen } from '../TaskFormScreen';
import { taskContext, type TaskContext } from './support';

let context: TaskContext | undefined;

// Fake only the system dialog; keep date conversion, validation and writes real.
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: jest.requireActual<typeof import('react-native')>('react-native').View,
}));

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  if (context !== undefined) {
    expect(context.http.requests).toEqual([]);
    expect(context.fileSystem.requests).toEqual([]);
    context.dispose();
  }
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene(edit = false, overrides: Partial<TaskTemplate> = {}) {
  const c = await taskContext();
  context = c;
  const pet = c.seedPet();
  const task = edit ? c.seedTask({ pet_ids: [pet.id], ...overrides }) : null;
  await render(<ReplicaProvider store={c.store}><AssetFilesProvider files={c.files}>
    <TaskFormScreen services={c.services} active onClose={c.onClose}
      {...(task === null ? {} : { taskId: task.id })} />
  </AssetFilesProvider></ReplicaProvider>);
  if (task === null) {
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Evening care');
    await fireEvent.press(within(screen.getByTestId('task-pets')).getByRole('button', { name: pet.name }));
  }
  return { ...c, task };
}

async function frequency(value: keyof typeof strings.tasks.frequencies) {
  await fireEvent.press(within(screen.getByTestId('task-freq')).getByRole('radio', {
    name: strings.tasks.frequencies[value],
  }));
}

async function pick(instant: string, mode: 'date' | 'time') {
  const picker = screen.getByTestId('task-native-picker');
  expect(picker.props).toMatchObject({ mode, timeZoneName: 'America/Sao_Paulo', is24Hour: true });
  const value = new Date(instant);
  await fireEvent(picker, 'valueChange', { nativeEvent: { timestamp: value.getTime(), utcOffset: -180 } }, value);
}

test.each([
  ['', 'required'], ['x'.repeat(81), 'out_of_range'],
] as const)('R3.6 title validation rejects %s with %s before enqueueing', async (title, code) => {
  const c = await scene();
  await fireEvent.changeText(screen.getByTestId('task-title'), title);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(screen.getByText(formatValidationError({ field: 'title', code }))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(0);
  expect(c.onClose).not.toHaveBeenCalled();
});

test('R3.6 weekly toggles start on Monday and require a day before saving', async () => {
  const c = await scene();
  await frequency('weekly');
  const days = within(screen.getByTestId('task-weekdays'));
  expect(days.getAllByRole('button').map((day) => day.props.accessibilityLabel)).toEqual(
    Object.values(strings.tasks.weekdayNames),
  );
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(screen.getByText(formatValidationError({ field: 'byday', code: 'required' }))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(0);
  await fireEvent.press(days.getByRole('button', { name: strings.tasks.weekdayNames.FR }));
  await fireEvent.press(days.getByRole('button', { name: strings.tasks.weekdayNames.MO }));
  await fireEvent.press(screen.getByRole('button', { name: strings.tasks.increaseInterval }));
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({
    recurrence: { freq: 'weekly', interval: 2, byday: ['MO', 'FR'] },
  }));
});

test('R3.6 monthly grid requires a day and saves selected days in order', async () => {
  const c = await scene();
  await frequency('monthly');
  const days = within(screen.getByTestId('task-monthdays'));
  expect(days.getAllByRole('button')).toHaveLength(31);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(screen.getByText(formatValidationError({ field: 'bymonthday', code: 'required' }))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(0);
  await fireEvent.press(days.getByRole('button', { name: strings.tasks.monthDay(31) }));
  await fireEvent.press(days.getByRole('button', { name: strings.tasks.monthDay(1) }));
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({
    recurrence: { freq: 'monthly', interval: 1, bymonthday: [1, 31] },
  }));
});

test('R3.6 once uses the native date picker and keeps starts_on equal to its date', async () => {
  const c = await scene();
  await frequency('once');
  expect(screen.queryByTestId('task-interval')).toBeNull();
  await fireEvent.press(screen.getByTestId('task-once-date'));
  await pick('2026-10-20T01:30:00Z', 'date');
  expect(screen.getByTestId('task-once-date')).toHaveTextContent(formatFullDate('2026-10-19'));
  expect(screen.getByTestId('task-starts')).toHaveTextContent(formatFullDate('2026-10-19'));
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({
    recurrence: { freq: 'once', date: '2026-10-19' }, starts_on: '2026-10-19',
  }));
});

test('R3.6 the new-task start picker uses family dates and can be dismissed', async () => {
  const c = await scene();
  expect(screen.getByTestId('task-starts')).toHaveTextContent(formatFullDate('2026-10-13'));
  await fireEvent.press(screen.getByTestId('task-starts'));
  await fireEvent(screen.getByTestId('task-native-picker'), 'dismiss');
  expect(screen.queryByTestId('task-native-picker')).toBeNull();
  expect(screen.getByTestId('task-starts')).toHaveTextContent(formatFullDate('2026-10-13'));
  await fireEvent.press(screen.getByTestId('task-starts'));
  await pick('2026-10-20T01:30:00Z', 'date');
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({ starts_on: '2026-10-19' }));
});

test('R3.6 edit hides starts_on while preserving the original start on cosmetic saves', async () => {
  const c = await scene(true);
  expect(screen.queryByTestId('task-starts')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Renamed');
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.task).not.toBeNull();
  expect(c.store.getState().taskTemplates[c.task?.id ?? '']?.starts_on).toBe('2026-10-01');
  expect(c.forkTask).not.toHaveBeenCalled();
});

test('R3.6 time chips sort native selections and stop at eight times', async () => {
  const c = await scene();
  expect(within(screen.getByTestId('task-times')).getByText(strings.format.allDay)).toBeOnTheScreen();
  const times = ['20:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'];
  for (const time of times) {
    await fireEvent.press(screen.getByRole('button', { name: strings.tasks.addTime }));
    await pick(`2026-10-13T${time}:00-03:00`, 'time');
  }
  expect(screen.getByRole('button', { name: strings.tasks.addTime })).toBeDisabled();
  expect(within(screen.getByTestId('task-times')).queryByText(strings.format.allDay)).toBeNull();
  expect(c.outbox.count()).toBe(0);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({ times_of_day: [...times].sort() }));
});

test('R3.6 duplicate native times show the shared message and removing the last time saves all-day', async () => {
  const c = await scene();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await fireEvent.press(screen.getByRole('button', { name: strings.tasks.addTime }));
    await pick('2026-10-13T08:00:00-03:00', 'time');
  }
  expect(screen.getByText(formatValidationError({ field: 'times_of_day', code: 'duplicate' }))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(0);
  await fireEvent.press(screen.getByRole('button', { name: strings.tasks.removeTime('08:00') }));
  expect(within(screen.getByTestId('task-times')).getByText(strings.format.allDay)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({ times_of_day: [] }));
});

test.each(['0', '1441'])('R3.6 timer minutes %s block enqueueing until corrected', async (minutes) => {
  const c = await scene();
  await fireEvent.press(screen.getByRole('switch', { name: strings.tasks.timer }));
  await fireEvent.changeText(screen.getByLabelText(strings.tasks.minutes), minutes);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(screen.getByText(formatValidationError({ field: 'timer_seconds', code: 'out_of_range' }))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(0);
  await fireEvent.changeText(screen.getByLabelText(strings.tasks.minutes), '1440');
  await fireEvent.press(screen.getByTestId('task-photo'));
  await fireEvent.changeText(screen.getByLabelText(strings.tasks.description), 'With food');
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({
    timer_seconds: 86400, requires_photo: true, description: 'With food',
  }));
});

test('R3.10 delete enqueues the local removal and closes exactly once', async () => {
  const c = await scene(true);
  const button = screen.getByTestId('task-delete');
  await fireEvent.press(button);
  expect(c.deleteTask).toHaveBeenCalledWith(c.task?.id);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'DELETE', path: `/tasks/${c.task?.id}` });
  expect(Object.values(c.store.getState().taskTemplates)).toEqual([]);
  await fireEvent.press(button);
  expect(c.deleteTask).toHaveBeenCalledTimes(1);
  expect(c.outbox.count()).toBe(1);
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test('R3.8 Q-48 a future fork note names the clamped effective date', async () => {
  const c = await scene(true, { starts_on: '2026-10-20' });
  if (c.task === null) throw new Error('Expected an edit task');
  const second = c.factory.pets({ name: 'Asteria' });
  await act(() => {
    c.seedPet(second);
  });
  await fireEvent.press(within(screen.getByTestId('task-pets')).getByRole('button', { name: second.name }));
  expect(screen.getByText(strings.tasks.effectiveDate(formatFullDate('2026-10-20')))).toBeOnTheScreen();
  expect(c.outbox.count()).toBe(0);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.forkTask).toHaveBeenCalledWith(c.task.id, expect.anything(), '2026-10-20');
});
