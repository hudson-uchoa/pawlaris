import type { ReactElement } from 'react';
import type { SharedValue } from 'react-native-reanimated';

export type SparksProps = {
  progress: SharedValue<number>;
  active: boolean;
  testID?: string;
};

export function Sparks(props: SparksProps): ReactElement | null {
  void props;
  throw new Error('Sparks is not implemented');
}
