import { classifyTaskEdit, validateTask, type TaskTemplate } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatScheduleSummary, formatValidationError } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import { queued } from '../../../sync/__tests__/support';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { TaskFormScreen } from '../TaskFormScreen';
import { TasksListScreen } from '../TasksListScreen';
import { taskContext, type TaskContext } from './support';

let context: TaskContext | undefined;

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

async function scene(role: Parameters<typeof taskContext>[0] = 'leader') {
  const c = await taskContext(role);
  context = c;
  return c;
}

async function paint(c: TaskContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>{children}</AssetFilesProvider>
  </ReplicaProvider>);
}

function form(c: TaskContext, taskId?: string) {
  return <TaskFormScreen services={c.services} active onClose={c.onClose}
    {...(taskId === undefined ? {} : { taskId })} />;
}

async function choosePet(name: string) {
  await fireEvent.press(within(screen.getByTestId('task-pets')).getByRole('button', { name }));
}

async function chooseMode(mode: TaskTemplate['completion_mode']) {
  await fireEvent.press(within(screen.getByTestId('task-mode')).getByRole('radio', {
    name: strings.tasks.modes[mode],
  }));
}

async function chooseReminder(reminder: TaskTemplate['reminder_class']) {
  await fireEvent.press(within(screen.getByTestId('task-reminder')).getByRole('radio', {
    name: strings.tasks.reminders[reminder],
  }));
}

function expectNoWrites(c: TaskContext) {
  expect(c.createTask).not.toHaveBeenCalled();
  expect(c.patchTask).not.toHaveBeenCalled();
  expect(c.forkTask).not.toHaveBeenCalled();
  expect(c.deleteTask).not.toHaveBeenCalled();
  expect(c.outbox.count()).toBe(0);
  expect(c.onClose).not.toHaveBeenCalled();
}

test('R3.5 medication presets per-pet and critical and creates locally', async () => {
  const c = await scene();
  const first = c.seedPet();
  const second = c.seedPet({ name: 'Asteria' });
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Evening dose');
  await choosePet(first.name);
  await choosePet(second.name);
  await fireEvent.press(within(screen.getByTestId('task-category')).getByRole('button', {
    name: strings.tasks.categories.medication,
  }));
  expect(within(screen.getByTestId('task-mode')).getByRole('radio', {
    name: strings.tasks.modes.per_pet,
  })).toBeChecked();
  expect(within(screen.getByTestId('task-reminder')).getByRole('radio', {
    name: strings.tasks.reminders.critical,
  })).toBeChecked();
  expectNoWrites(c);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledTimes(1);
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Evening dose',
    pet_ids: [first.id, second.id], category: 'medication', completion_mode: 'per_pet',
    reminder_class: 'critical', starts_on: '2026-10-13' }));
  const body = c.createTask.mock.calls[0]?.[0];
  expect(validateTask(body)).toEqual([]);
  expect(c.outbox.count()).toBe(1);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'POST', path: '/tasks' });
  expect(Object.values(c.store.getState().taskTemplates)).toEqual([
    expect.objectContaining({ title: 'Evening dose', completion_mode: 'per_pet', reminder_class: 'critical' }),
  ]);
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test('R3.5 medication presets remain editable before saving', async () => {
  const c = await scene();
  const first = c.seedPet();
  const second = c.seedPet({ name: 'Asteria' });
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Evening dose');
  await choosePet(first.name);
  await choosePet(second.name);
  await fireEvent.press(within(screen.getByTestId('task-category')).getByRole('button', {
    name: strings.tasks.categories.medication,
  }));
  await chooseMode('together');
  await chooseReminder('routine');
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({ category: 'medication',
    completion_mode: 'together', reminder_class: 'routine' }));
});

test('R3.1 zero pets blocks save with the shared validation message', async () => {
  const c = await scene();
  c.seedPet();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Feed the cats');
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(screen.getByText(formatValidationError({ field: 'pet_ids', code: 'required' }))).toBeOnTheScreen();
  expectNoWrites(c);
});

test('R3.4 one selected pet hides the mode control and saves together', async () => {
  const c = await scene();
  const first = c.seedPet();
  const second = c.seedPet({ name: 'Asteria' });
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Feed the cats');
  await choosePet(first.name);
  expect(screen.queryByTestId('task-mode')).toBeNull();
  await choosePet(second.name);
  await chooseMode('per_pet');
  await choosePet(second.name);
  expect(screen.queryByTestId('task-mode')).toBeNull();
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({
    pet_ids: [first.id], completion_mode: 'together',
  }));
});

test('R3.1 archived pets are not offered for selection', async () => {
  const c = await scene();
  const live = c.seedPet();
  const archived = c.seedPet({ name: 'Asteria', archived_at: new Date(c.clock.now()).toISOString() });
  await paint(c, form(c));
  const pets = within(screen.getByTestId('task-pets'));
  expect(pets.getByRole('button', { name: live.name })).toBeOnTheScreen();
  expect(pets.queryByRole('button', { name: archived.name })).toBeNull();
});

test('R3.7 a cosmetic edit calls patchTask only and preserves the schedule', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id] });
  expect(classifyTaskEdit(task, { title: 'New title' })).toBe('cosmetic');
  await paint(c, form(c, task.id));
  expect(screen.getByTestId('task-title')).toHaveDisplayValue(task.title);
  await fireEvent.changeText(screen.getByTestId('task-title'), 'New title');
  expect(screen.queryByText(strings.tasks.effectiveToday)).toBeNull();
  expect(screen.queryByText(strings.tasks.effectiveTomorrow)).toBeNull();
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.patchTask).toHaveBeenCalledTimes(1);
  expect(c.patchTask).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: 'New title' }));
  expect(c.createTask).not.toHaveBeenCalled();
  expect(c.forkTask).not.toHaveBeenCalled();
  expect(c.deleteTask).not.toHaveBeenCalled();
  expect(queued(c)).toEqual([expect.objectContaining({ method: 'PATCH', path: `/tasks/${task.id}` })]);
  expect(c.store.getState().taskTemplates[task.id]).toMatchObject({ title: 'New title',
    recurrence: task.recurrence, times_of_day: task.times_of_day, starts_on: task.starts_on,
    pet_ids: task.pet_ids, completion_mode: task.completion_mode });
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test.each([
  ['none', '2026-10-13', '2026-10-12'],
  ['live today', '2026-10-14', '2026-10-13'],
  ['undone today', '2026-10-13', '2026-10-12'],
  ['live yesterday', '2026-10-13', '2026-10-12'],
  ['another task', '2026-10-13', '2026-10-12'],
] as const)('R3.8 schedule edits with %s fork at %s and end the old task on %s', async (completion, effective, oldEnd) => {
  const c = await scene();
  const first = c.seedPet();
  const second = c.seedPet({ name: 'Asteria' });
  const task = c.seedTask({ pet_ids: [first.id] });
  if (completion !== 'none') {
    c.seedCompletion(task, {
      task_id: completion === 'another task' ? c.seedTask({ pet_ids: [first.id] }).id : task.id,
      occurrence_key: completion === 'live yesterday' ? '2026-10-12T08:00' : '2026-10-13T08:00',
      undone_at: completion === 'undone today' ? new Date(c.clock.now()).toISOString() : null,
      undone_by: completion === 'undone today' ? c.sessionUser.id : null,
    });
  }
  const edits = { pet_ids: [first.id, second.id] };
  expect(classifyTaskEdit(task, edits)).toBe('schedule');
  await paint(c, form(c, task.id));
  await choosePet(second.name);
  const tomorrow = completion === 'live today';
  expect(screen.getByText(tomorrow ? strings.tasks.effectiveTomorrow : strings.tasks.effectiveToday)).toBeOnTheScreen();
  expect(screen.queryByText(tomorrow ? strings.tasks.effectiveToday : strings.tasks.effectiveTomorrow)).toBeNull();
  expectNoWrites(c);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.forkTask).toHaveBeenCalledTimes(1);
  expect(c.forkTask).toHaveBeenCalledWith(task.id, expect.objectContaining(edits), effective);
  expect(c.patchTask).not.toHaveBeenCalled();
  expect(c.createTask).not.toHaveBeenCalled();
  expect(c.deleteTask).not.toHaveBeenCalled();
  expect(queued(c)).toEqual([
    expect.objectContaining({ method: 'POST', path: '/tasks', body: expect.objectContaining({
      starts_on: effective, replaces_task_id: task.id, pet_ids: edits.pet_ids,
    }) }),
    expect.objectContaining({ method: 'PATCH', path: `/tasks/${task.id}`, body: { ends_on: oldEnd } }),
  ]);
  expect(c.store.getState().taskTemplates[task.id]?.ends_on).toBe(oldEnd);
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test.each(['self', 'nobody'] as const)('R3.3 a member cannot pick another assignee and can save for %s', async (assignee) => {
  const c = await scene('member');
  const pet = c.seedPet();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Feed Aurora');
  await choosePet(pet.name);
  const choices = within(screen.getByTestId('task-assignee'));
  const other = choices.getByRole('radio', { name: c.other.display_name });
  expect(other).toBeDisabled();
  await fireEvent.press(other);
  expect(other).not.toBeChecked();
  await fireEvent.press(choices.getByRole('radio', {
    name: assignee === 'self' ? c.services.sessionUser().display_name : strings.tasks.anyone,
  }));
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.createTask).toHaveBeenCalledWith(expect.objectContaining({
    assigned_to: assignee === 'self' ? c.sessionUser.id : null,
  }));
});

test('R3.3 a leader can assign another member on someone else\'s task', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], created_by: c.other.id });
  await paint(c, form(c, task.id));
  const other = within(screen.getByTestId('task-assignee')).getByRole('radio', { name: c.other.display_name });
  expect(other).toBeEnabled();
  await fireEvent.press(other);
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(c.patchTask).toHaveBeenCalledWith(task.id, expect.objectContaining({ assigned_to: c.other.id }));
  expect(c.forkTask).not.toHaveBeenCalled();
});

test('R3.3 a member sees someone else\'s task read-only with its explanation', async () => {
  const c = await scene('member');
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], created_by: c.other.id });
  await paint(c, form(c, task.id));
  expect(screen.getByText(strings.tasks.readOnly)).toBeOnTheScreen();
  const title = screen.getByTestId('task-title');
  expect(title).toHaveDisplayValue(task.title);
  expect(title).toHaveProp('editable', false);
  const save = screen.queryByTestId('task-save');
  if (save !== null) {
    expect(save).toBeDisabled();
    await fireEvent.press(save);
  }
  for (const id of ['task-category', 'task-pets', 'task-mode', 'task-assignee', 'task-reminder']) {
    const control = screen.queryByTestId(id);
    if (control !== null) {
      for (const option of [...within(control).queryAllByRole('button'), ...within(control).queryAllByRole('radio')]) {
        expect(option).toBeDisabled();
      }
    }
  }
  expect(screen.queryByTestId('task-end')).toBeNull();
  expect(screen.queryByTestId('task-delete')).toBeNull();
  expectNoWrites(c);
});

test.each(['none', 'live', 'undone', 'historical', 'another task'] as const)(
  'R3.10 delete visibility counts all replica completions: %s', async (completion) => {
    const c = await scene();
    const pet = c.seedPet();
    const task = c.seedTask({ pet_ids: [pet.id] });
    if (completion !== 'none') {
      c.seedCompletion(task, {
        task_id: completion === 'another task' ? c.seedTask({ pet_ids: [pet.id] }).id : task.id,
        occurrence_key: completion === 'historical' ? '2026-10-12T08:00' : '2026-10-13T08:00',
        undone_at: completion === 'undone' ? new Date(c.clock.now()).toISOString() : null,
        undone_by: completion === 'undone' ? c.sessionUser.id : null,
      });
    }
    await paint(c, form(c, task.id));
    if (completion === 'none' || completion === 'another task') {
      expect(screen.getByTestId('task-delete')).toBeOnTheScreen();
    } else expect(screen.queryByTestId('task-delete')).toBeNull();
    expect(screen.getByTestId('task-end')).toBeOnTheScreen();
    expectNoWrites(c);
  },
);

test.each([false, true])('R3.9 ending waits for confirmation and respects today completion=%s', async (completed) => {
  const c = await scene();
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id] });
  if (completed) c.seedCompletion(task);
  await paint(c, form(c, task.id));
  await fireEvent.press(screen.getByTestId('task-end'));
  const sheet = screen.getByRole('dialog', { name: strings.tasks.end });
  expect(within(sheet).getByText(strings.tasks.endBody)).toBeOnTheScreen();
  expectNoWrites(c);
  await fireEvent.press(within(sheet).getByRole('button', { name: strings.tasks.end }));
  expect(c.patchTask).toHaveBeenCalledWith(task.id, { ends_on: completed ? '2026-10-13' : '2026-10-12' });
  expect(c.forkTask).not.toHaveBeenCalled();
  expect(c.deleteTask).not.toHaveBeenCalled();
  expect(c.onClose).toHaveBeenCalledTimes(1);
});

test('R3.9 R5.1 the task list separates active and ended templates using the family date', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const active = c.seedTask({ pet_ids: [pet.id], title: 'Ongoing' });
  const lastDay = c.seedTask({ pet_ids: [pet.id], title: 'Last day', ends_on: '2026-10-13' });
  const ended = c.seedTask({ pet_ids: [pet.id], title: 'Ended', ends_on: '2026-10-12' });
  await paint(c, <TasksListScreen services={c.services} active onOpenTask={c.onOpenTask} />);
  expect(screen.getByText(active.title)).toBeOnTheScreen();
  expect(screen.getByText(lastDay.title)).toBeOnTheScreen();
  expect(screen.queryByText(ended.title)).toBeNull();
  await fireEvent.press(screen.getByRole('radio', { name: strings.tasks.ended }));
  expect(screen.getByText(ended.title)).toBeOnTheScreen();
  expect(screen.queryByText(active.title)).toBeNull();
  expect(screen.queryByText(lastDay.title)).toBeNull();
  expectNoWrites(c);
});

test('R5.1 task list rows show replica pets, schedule and assignee and open the task', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const task = c.seedTask({ pet_ids: [pet.id], assigned_to: c.other.id });
  await paint(c, <TasksListScreen services={c.services} active onOpenTask={c.onOpenTask} />);
  const row = screen.getByRole('button', { name: task.title });
  expect(within(row).getByText(pet.name)).toBeOnTheScreen();
  expect(within(row).getByText(c.other.display_name)).toBeOnTheScreen();
  expect(within(row).getByText(formatScheduleSummary({
    recurrence: task.recurrence, timesOfDay: task.times_of_day,
  }))).toBeOnTheScreen();
  await fireEvent.press(row);
  expect(c.onOpenTask).toHaveBeenCalledWith(task.id);
  await act(() => {
    c.seedTask({ pet_ids: [pet.id], title: 'For anyone' });
  });
  expect(within(screen.getByRole('button', { name: 'For anyone' })).getByText(strings.tasks.anyone)).toBeOnTheScreen();
  expectNoWrites(c);
});

test('R3.4 R3.5 selecting one pet before medication saves together and critical', async () => {
  const c = await scene();
  const pet = c.seedPet();
  await paint(c, form(c));
  await fireEvent.changeText(screen.getByTestId('task-title'), 'Evening dose');
  await choosePet(pet.name);
  await fireEvent.press(within(screen.getByTestId('task-category')).getByRole('button', {
    name: strings.tasks.categories.medication,
  }));
  expect(screen.queryByTestId('task-mode')).toBeNull();
  await fireEvent.press(screen.getByTestId('task-save'));
  expect(Object.values(c.store.getState().taskTemplates)).toEqual([
    expect.objectContaining({ pet_ids: [pet.id], category: 'medication',
      completion_mode: 'together', reminder_class: 'critical' }),
  ]);
  expect(queued(c)).toEqual([
    expect.objectContaining({ method: 'POST', path: '/tasks', body: expect.objectContaining({
      pet_ids: [pet.id], category: 'medication', completion_mode: 'together', reminder_class: 'critical',
    }) }),
  ]);
});
