import type { Pet } from './entities';

export type PetListKind = 'breed' | 'coat';
export type PetListKeys = Readonly<Record<Pet['species'], readonly string[]>>;
export type PetListOption = { readonly key: string; readonly name: string };

export const PET_BREEDS: PetListKeys = { cat: [], dog: [] };
export const PET_COATS: PetListKeys = { cat: [], dog: [] };

export function searchPetList(
  options: readonly PetListOption[],
  query: string,
): readonly PetListOption[] {
  void options;
  void query;
  throw new Error('not implemented');
}
