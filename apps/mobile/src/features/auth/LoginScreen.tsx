import type { ReactElement } from 'react';
import type { AuthScreenProps } from './types';

export type LoginScreenProps = AuthScreenProps & { onRedeem(): void };

export function LoginScreen(props: LoginScreenProps): ReactElement {
  void props;
  throw new Error('LoginScreen not implemented');
}
