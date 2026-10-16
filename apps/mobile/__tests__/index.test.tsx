import { cleanup, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

import Index from '../app/index';

// The route now supplies focus to the cosmos kit; this unit test has no navigator.
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
const initialAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  AppState.currentState = 'active';
});

afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
  AppState.currentState = initialAppState;
});

it('P0-5 renders the Pawlaris name', async () => {
  await render(<Index />);

  expect(screen.getByText('Pawlaris')).toBeOnTheScreen();
});
