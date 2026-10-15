import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { useReduceMotion } from '../motion/useReduceMotion';
import { useTheme } from '../theme';
import { dark, light } from '../tokens/color';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

type AnimationAPI = typeof import('react-native-reanimated');
const reducedMotionHook = jest.requireActual<Pick<AnimationAPI, 'useReducedMotion'>>('react-native-reanimated/src/hook/useReducedMotion');

afterEach(() => { jest.restoreAllMocks(); });

test('R7.5 useTheme follows system light and dark changes', async () => {
  const scheme = jest.mocked(useColorScheme).mockReturnValue('light');
  const hook = await renderHook(useTheme);
  expect(hook.result.current).toMatchObject({ scheme: 'light', color: light });
  scheme.mockReturnValue('dark');
  await hook.rerender(undefined);
  expect(hook.result.current).toMatchObject({ scheme: 'dark', color: dark });
});

test.each([false, true])('P9 useReduceMotion forwards Reanimated preference %s', async (preference) => {
  jest.spyOn(reducedMotionHook, 'useReducedMotion').mockReturnValue(preference);
  const hook = await renderHook(useReduceMotion);
  expect(hook.result.current).toBe(preference);
});
