import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import type { AppRuntime } from './bootstrap';
import { AssetFilesProvider } from './assets/useAssetFile';
import { ReplicaProvider } from './replica/useReplica';
import { useTheme, type Theme } from './ui/theme';

export type AppContext = AppRuntime & { theme: Theme };
const Context = createContext<AppContext | null>(null);

export function AppProvider({ runtime, children }: { runtime: AppRuntime; children: ReactNode }): ReactElement {
  const theme = useTheme();
  const value = useMemo(() => ({ ...runtime, theme }), [runtime, theme]);
  return <Context.Provider value={value}><ReplicaProvider store={runtime.store}>
    <AssetFilesProvider files={runtime.assetFiles}>{children}</AssetFilesProvider>
  </ReplicaProvider></Context.Provider>;
}

export function useApp(): AppContext {
  const app = useContext(Context);
  if (app === null) throw new Error('useApp requires an AppProvider');
  return app;
}
