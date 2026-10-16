import type { ReactElement } from 'react';
import type { AppDependencies } from '../src/bootstrap';

export type RootLayoutProps = { dependencies?: AppDependencies };

export default function RootLayout(props: RootLayoutProps = {}): ReactElement {
  void props;
  throw new Error('App shell not implemented');
}
