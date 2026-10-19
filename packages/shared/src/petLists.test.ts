import { describe, expect, it } from 'vitest';
import { PET_BREEDS, PET_COATS, searchPetList } from './petLists';

describe('09 §4.2.1 species lists', () => {
  it('keeps every cat breed in specification order with SRD first', () => {
    expect(PET_BREEDS.cat).toEqual([
      'srd', 'siamese', 'persian', 'maine_coon', 'angora', 'ragdoll', 'bengal',
      'british_shorthair', 'exotic', 'himalayan', 'russian_blue', 'birman',
      'scottish_fold', 'sphynx', 'abyssinian', 'chartreux', 'bombay',
    ]);
  });

  it('keeps every dog breed in specification order with SRD first', () => {
    expect(PET_BREEDS.dog).toEqual([
      'srd', 'shih_tzu', 'yorkshire', 'poodle', 'lhasa_apso', 'pomeranian',
      'golden_retriever', 'labrador', 'french_bulldog', 'english_bulldog', 'pug',
      'dachshund', 'pinscher', 'maltese', 'beagle', 'chihuahua', 'schnauzer',
      'border_collie', 'german_shepherd', 'belgian_shepherd', 'rottweiler',
      'pit_bull', 'siberian_husky', 'boxer', 'cocker_spaniel', 'akita',
      'chow_chow', 'dobermann', 'jack_russell', 'dalmatian', 'brazilian_terrier', 'fila',
    ]);
  });

  it('keeps every cat coat in specification order', () => {
    expect(PET_COATS.cat).toEqual([
      'black', 'white', 'gray', 'orange', 'cream', 'tabby', 'tuxedo',
      'tortoiseshell', 'calico', 'colorpoint',
    ]);
  });

  it('keeps every dog coat in specification order', () => {
    expect(PET_COATS.dog).toEqual([
      'black', 'white', 'brown', 'caramel', 'golden', 'cream', 'gray', 'brindle',
      'black_white', 'tricolor', 'merle',
    ]);
  });
});

describe('09 §4.2.1 search ignores case and accents', () => {
  const options = [
    { key: 'cafe', name: 'Café' },
    { key: 'cream', name: 'Crème' },
    { key: 'black', name: 'Black' },
    { key: 'cafe_light', name: 'Cafe Light' },
  ];

  it.each([
    ['CAFE', ['cafe', 'cafe_light']],
    ['cAfÉ', ['cafe', 'cafe_light']],
    ['CREME', ['cream']],
    ['BLÁCK', ['black']],
    ['', ['cafe', 'cream', 'black', 'cafe_light']],
    ['absent', []],
  ])('matches %s without changing the original order or options', (query, keys) => {
    const before = options.map((option) => ({ ...option }));
    expect(searchPetList(options, query).map((option) => option.key)).toEqual(keys);
    expect(options).toEqual(before);
  });
});
