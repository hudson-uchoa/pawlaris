import type { AuthUser, Pet } from '@pawlaris/shared';
import { createAssetFiles } from '../../../assets/files';
import { servers } from '../../../auth/__tests__/support';
import { syncContext } from '../../../sync/__tests__/support';
import { fakeFileSystem } from '../../../testing/fakeFileSystem';
import type { PetScreenServices } from '../types';

export async function petContext(role: AuthUser['role'] = 'leader') {
  const c = await syncContext();
  const user = { ...c.sessionUser, role };
  const fileSystem = fakeFileSystem();
  const files = createAssetFiles({ ...c, servers, fileSystem,
    activeServer: () => 'primary', documentDirectory: 'file:///fake/documents/' });
  c.driver.transaction(() => {
    c.apply.applyLocalRow('family', c.factory.family({ id: user.family_id }));
    c.apply.applyLocalRow('members', c.factory.members({ id: user.id, role }));
  });
  const services: PetScreenServices = {
    clock: c.clock, sessionUser: () => user, mutations: c.mutations,
  };
  const createPet = jest.spyOn(c.mutations, 'createPet');
  const onClose = jest.fn();
  const onAvatar = jest.fn();
  const onAdd = jest.fn();
  const onOpenPet = jest.fn();
  function seedPet(overrides: Partial<Pet> = {}): Pet {
    const pet = c.factory.pets(overrides);
    c.driver.transaction(() => { c.apply.applyLocalRow('pets', pet); });
    return pet;
  }
  return { ...c, services, files, fileSystem, createPet, seedPet,
    onClose, onAvatar, onAdd, onOpenPet,
    dispose() { files.uploads.dispose(); c.driver.close(); },
  };
}

export type PetContext = Awaited<ReturnType<typeof petContext>>;
