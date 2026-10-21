import type { Pet } from './entities';

export type PetListKind = 'breed' | 'coat';
export type PetListKeys = Readonly<Record<Pet['species'], readonly string[]>>;
export type PetListOption = { readonly key: string; readonly name: string };

export const PET_BREEDS = {
  cat: [
    'srd', 'siamese', 'persian', 'maine_coon', 'angora', 'ragdoll', 'bengal',
    'british_shorthair', 'exotic', 'himalayan', 'russian_blue', 'birman',
    'scottish_fold', 'sphynx', 'abyssinian', 'chartreux', 'bombay',
  ],
  dog: [
    'srd', 'shih_tzu', 'yorkshire', 'poodle', 'lhasa_apso', 'pomeranian',
    'golden_retriever', 'labrador', 'french_bulldog', 'english_bulldog', 'pug',
    'dachshund', 'pinscher', 'maltese', 'beagle', 'chihuahua', 'schnauzer',
    'border_collie', 'german_shepherd', 'belgian_shepherd', 'rottweiler',
    'pit_bull', 'siberian_husky', 'boxer', 'cocker_spaniel', 'akita',
    'chow_chow', 'dobermann', 'jack_russell', 'dalmatian', 'brazilian_terrier', 'fila',
  ],
} as const satisfies PetListKeys;
export const PET_COATS = {
  cat: [
    'black', 'white', 'gray', 'orange', 'cream', 'tabby', 'tuxedo',
    'tortoiseshell', 'calico', 'colorpoint',
  ],
  dog: [
    'black', 'white', 'brown', 'caramel', 'golden', 'cream', 'gray', 'brindle',
    'black_white', 'tricolor', 'merle',
  ],
} as const satisfies PetListKeys;

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function searchPetList(
  options: readonly PetListOption[],
  query: string,
): readonly PetListOption[] {
  const normalizedQuery = normalizeSearch(query);
  return options.filter((option) => normalizeSearch(option.name).includes(normalizedQuery));
}
