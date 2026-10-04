import { describe, expect, it } from 'vitest';
import { IDENTITY_KEYS, identityIndexForId, identityIndexForKey } from './identity';

const keys = ['#5B7DB1', '#B15B6B', '#4F8A6B', '#C88A2E', '#7A65B0', '#3F8F97', '#B5654A', '#B15B9E'];

describe('identity palette', () => {
  it('IK-1 exports the eight identity keys in their specified order', () => {
    expect(IDENTITY_KEYS).toEqual(keys);
    expect(identityIndexForKey(keys[0] ?? '')).toBe(0);
  });

  it.each(keys.map((key, index) => ({ key, index })))('IK-2 maps $key to $index', ({ key, index }) => {
    expect(identityIndexForKey(key)).toBe(index);
  });

  it('IK-3 falls back to index zero for an unknown key', () => {
    for (const key of ['', '#000000', '#5b7db1', 'polaris']) expect(identityIndexForKey(key)).toBe(0);
  });

  it.each([
    ['', 0], ['a', 1], ['b', 2], ['ab', 3], ['ba', 3], ['ABC', 6], ['h', 0], ['😀', 5],
  ] as const)('IK-4 maps id %s to the character-code index %s', (id, expected) => {
    expect(identityIndexForId(id)).toBe(expected);
  });
});
