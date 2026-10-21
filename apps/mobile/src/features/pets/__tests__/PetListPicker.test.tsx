import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { expectedOtherLabel, expectedPetLists } from '../../../i18n/__tests__/petListExpectations';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { PetFormScreen } from '../PetFormScreen';
import { petContext, type PetContext } from './support';

let context: PetContext | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('09 §4.2 Other clears a picked breed before saving the typed text', async () => {
  const c = await petContext();
  context = c;
  await render(<ReplicaProvider store={c.store}>
    <PetFormScreen services={c.services} active onClose={c.onClose} onAvatar={c.onAvatar} />
  </ReplicaProvider>);
  await fireEvent.changeText(screen.getByTestId('pet-name'), 'Vega');
  await fireEvent.press(within(screen.getByTestId('pet-species')).getByRole('radio', { name: strings.pets.cat }));
  await fireEvent.press(screen.getByTestId('pet-breed'));
  await fireEvent.press(within(screen.getByRole('dialog', { name: strings.pets.breed }))
    .getByRole('button', { name: expectedPetLists.breeds.cat.maine_coon }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  expect(within(screen.getByTestId('pet-breed')).getByText(expectedPetLists.breeds.cat.maine_coon)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('pet-breed'));
  await fireEvent.press(within(screen.getByRole('dialog', { name: strings.pets.breed }))
    .getByRole('button', { name: expectedOtherLabel }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  expect(screen.getByTestId('pet-breed')).toHaveDisplayValue('');
  await fireEvent.changeText(screen.getByTestId('pet-breed'), 'Family breed');
  await fireEvent.press(screen.getByTestId('pet-save'));
  expect(Object.values(c.store.getState().pets)).toEqual([expect.objectContaining({ breed: 'Family breed' })]);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ body: expect.objectContaining({ breed: 'Family breed' }) });
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});
