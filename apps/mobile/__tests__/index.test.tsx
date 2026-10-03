import { render, screen } from '@testing-library/react-native';

import Index from '../app/index';

it('P0-5 renders the Pawlaris name', async () => {
  await render(<Index />);

  expect(screen.getByText('Pawlaris')).toBeOnTheScreen();
});
