import type { ReactElement, ReactNode } from 'react';
import type { AppRuntime } from './bootstrap';
import type { Theme } from './ui/theme';

export type AppContext = AppRuntime & { theme: Theme };

export function AppProvider(props: { runtime: AppRuntime; children: ReactNode }): ReactElement {
  void props;
  throw new Error('App provider not implemented');
}

export function useApp(): AppContext {
  throw new Error('App context not implemented');
}
