import { measure, type MeasuredDimensions } from 'react-native-reanimated';
import type { Endpoint, Frames } from './types';

function visible(frame: MeasuredDimensions | null, width: number, height: number): frame is MeasuredDimensions {
  'worklet';
  return frame !== null && [frame.pageX, frame.pageY, frame.width, frame.height].every(Number.isFinite)
    && frame.width > 0 && frame.height > 0
    && frame.pageX < width && frame.pageY < height
    && frame.pageX + frame.width > 0 && frame.pageY + frame.height > 0;
}

export function measureFrames(endpoint: Endpoint | null, width: number, height: number): Frames | null {
  'worklet';
  if (endpoint === null) return null;
  const avatar = measure(endpoint.avatar);
  const name = measure(endpoint.name);
  return visible(avatar, width, height) && visible(name, width, height) ? { avatar, name } : null;
}
