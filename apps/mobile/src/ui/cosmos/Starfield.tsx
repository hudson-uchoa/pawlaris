import type { ReactElement, ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';

export type StarfieldProps = {
  seed: number;
  width: number;
  height: number;
  active: boolean;
  density?: 'header' | 'full';
  nebula?: boolean;
  scrollY?: SharedValue<number>;
  children?: ReactNode;
  testID?: string;
};

export function Starfield(props: StarfieldProps): ReactElement {
  void props;
  throw new Error('Starfield is not implemented');
}
