import { act } from '@testing-library/react-native';

type AnimationAPI = typeof import('react-native-reanimated');
const animationEntry = jest.requireActual<{ main: string }>('react-native-reanimated/package.json').main;
const animationRoot = `react-native-reanimated/${animationEntry.replace(/\/index(?:\.js)?$/, '')}`;

// Reuse the MO-3 and P6 motion tests' real animation exports. The public
// barrel has read-only getters; the worklets keep running under Jest.
export const timingAnimation = jest.requireActual<Pick<AnimationAPI, 'withTiming'>>(`${animationRoot}/animation/timing`);
export const springAnimation = jest.requireActual<Pick<AnimationAPI, 'withSpring'>>(`${animationRoot}/animation/spring/spring`);
export const repeatAnimation = jest.requireActual<Pick<AnimationAPI, 'withRepeat'>>(`${animationRoot}/animation/repeat`);
export const delayAnimation = jest.requireActual<Pick<AnimationAPI, 'withDelay'>>(`${animationRoot}/animation/delay`);
export const animationUtil = jest.requireActual<Pick<AnimationAPI, 'cancelAnimation'>>(`${animationRoot}/animation/util`);

export async function advance(milliseconds: number): Promise<void> {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}
