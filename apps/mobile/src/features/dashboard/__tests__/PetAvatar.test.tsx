import { identityIndexForId } from '@pawlaris/shared';
import { cleanup, render, screen } from '@testing-library/react-native';
import { rowFactories } from '../../../testing/rowFactories';
import { sequentialIds } from '../../../testing/sequentialIds';
import * as Theme from '../../../ui/theme';
import { dark, identity, light } from '../../../ui/tokens/color';
import { PetAvatar } from '../PetAvatar';

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

test.each(['light', 'dark'] as const)('R2.13 dashboard avatar uses the chosen identity in %s', async (scheme) => {
  jest.spyOn(Theme, 'useTheme').mockReturnValue({ scheme, color: scheme === 'dark' ? dark : light });
  const pet = rowFactories({ now: () => 0 }, sequentialIds()).pets();
  const derived = identity[identityIndexForId(pet.id)] ?? identity[0];
  const chosen = identity[(identityIndexForId(pet.id) + 1) % identity.length] ?? identity[0];
  expect(chosen[scheme]).not.toBe(derived[scheme]);
  await render(<PetAvatar pet={{ ...pet, identity_color: chosen.key }} />);
  expect(screen.getByRole('image', { name: pet.name })).toHaveStyle({ backgroundColor: chosen[scheme] });
});
