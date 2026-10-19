import type { AuthUser, Completion, Pet, TaskTemplate } from '@pawlaris/shared';
import { createAssetFiles } from '../../../assets/files';
import { servers } from '../../../auth/__tests__/support';
import { syncContext } from '../../../sync/__tests__/support';
import { fakeFileSystem } from '../../../testing/fakeFileSystem';
import type { TaskScreenServices } from '../types';

export async function taskContext(role: AuthUser['role'] = 'leader', randomValues: number[] = []) {
  const c = await syncContext(undefined, randomValues);
  // UTC has reached the next day; the family is still on October 13.
  c.clock.advance(Date.parse('2026-10-14T01:30:00Z') - c.clock.now());
  const user = { ...c.sessionUser, role };
  const other = c.factory.members({ display_name: 'Duda', role: 'member' });
  const fileSystem = fakeFileSystem();
  const files = createAssetFiles({ ...c, servers, fileSystem,
    activeServer: () => 'primary', documentDirectory: 'file:///fake/documents/' });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('family', c.factory.family({ id: user.family_id }));
    c.apply.applyLocalRow('members', c.factory.members({ id: user.id, role }));
    c.apply.applyLocalRow('members', other);
  });
  const services: TaskScreenServices = {
    clock: c.clock, sessionUser: () => user, mutations: c.mutations,
  };
  function seedPet(overrides: Partial<Pet> = {}): Pet {
    const pet = c.factory.pets(overrides);
    c.driver.transaction(() => { c.apply.applyLocalRow('pets', pet); });
    return pet;
  }
  function seedTask(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
    const task = c.factory.task_templates({ created_by: user.id, starts_on: '2026-10-01', ...overrides });
    c.driver.transaction(() => { c.apply.applyLocalRow('task_templates', task); });
    return task;
  }
  function seedCompletion(task: TaskTemplate, overrides: Partial<Completion> = {}): Completion {
    const completion = c.factory.task_completions({ task_id: task.id,
      title_snapshot: task.title, ...overrides });
    c.driver.transaction(() => { c.apply.applyLocalRow('task_completions', completion); });
    return completion;
  }
  return { ...c, services, other, files, fileSystem, seedPet, seedTask, seedCompletion,
    createTask: jest.spyOn(c.mutations, 'createTask'),
    patchTask: jest.spyOn(c.mutations, 'patchTask'),
    forkTask: jest.spyOn(c.mutations, 'forkTask'),
    deleteTask: jest.spyOn(c.mutations, 'deleteTask'),
    onClose: jest.fn(), onOpenTask: jest.fn(),
    dispose() { files.uploads.dispose(); c.driver.close(); },
  };
}

export type TaskContext = Awaited<ReturnType<typeof taskContext>>;
