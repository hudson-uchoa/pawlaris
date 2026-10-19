import { strings } from '../strings';
import { expectedPetLists } from './petListExpectations';

test.each([
  ['breeds', 'cat'], ['breeds', 'dog'], ['coats', 'cat'], ['coats', 'dog'],
] as const)('09 §4.2.1 strings.ts names every %s key for %s', (kind, species) => {
  expect(strings.pets).toMatchObject({ [kind]: { [species]: expectedPetLists[kind][species] } });
});
