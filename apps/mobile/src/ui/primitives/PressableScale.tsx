import type { ReactElement } from 'react';
import type { PressableProps } from 'react-native';

export type PressableScaleProps = Omit<PressableProps, 'accessibilityLabel'> & {
  accessibilityLabel: string;
};

export function PressableScale(_props: PressableScaleProps): ReactElement | null {
  return null;
}
