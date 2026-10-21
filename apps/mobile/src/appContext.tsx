import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import type { AppRuntime } from './bootstrap';
import { AssetFilesProvider } from './assets/useAssetFile';
import { ReplicaProvider } from './replica/useReplica';
import { useTheme, type Theme } from './ui/theme';
import { WalkRoutesProvider } from './walks/useWalkRoute';

export type AppContext = AppRuntime & { theme: Theme };
const Context = createContext<AppContext | null>(null);

export function AppProvider({ runtime, children }: { runtime: AppRuntime; children: ReactNode }): ReactElement {
  const theme = useTheme();
  const value = useMemo(() => ({ ...runtime, theme }), [runtime, theme]);
  return <Context.Provider value={value}><ReplicaProvider store={runtime.store}>
    <AssetFilesProvider files={runtime.assetFiles}>
      <WalkRoutesProvider routes={runtime.walkRoutes}>{children}</WalkRoutesProvider>
    </AssetFilesProvider>
  </ReplicaProvider></Context.Provider>;
}

export function useApp(): AppContext {
  const app = useOptionalApp();
  if (app === null) throw new Error('useApp requires an AppProvider');
  return app;
}

export function useOptionalApp(): AppContext | null {
  return useContext(Context);
}
