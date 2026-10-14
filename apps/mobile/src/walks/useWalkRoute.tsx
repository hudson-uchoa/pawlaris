import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { WalkRouteResult, WalkRoutes } from './routes';

export type WalkRouteState = WalkRouteResult | { status: 'pending'; points?: undefined };
export const WalkRoutesContext = createContext<WalkRoutes | null>(null);

export function WalkRoutesProvider(props: { routes: WalkRoutes; children?: ReactNode }): ReactNode {
  return <WalkRoutesContext.Provider value={props.routes}>{props.children}</WalkRoutesContext.Provider>;
}

export function useWalkRoute(id: string): WalkRouteState {
  const routes = useContext(WalkRoutesContext);
  if (routes === null) throw new Error('useWalkRoute requires a WalkRoutesProvider');
  const [loaded, setLoaded] = useState<{ id: string; value: WalkRouteState }>({
    id, value: { status: 'pending' },
  });
  useEffect(() => {
    let active = true;
    void routes.ensureRoute(id).then((value) => {
      if (active) setLoaded({ id, value });
    });
    return () => { active = false; };
  }, [routes, id]);
  return loaded.id === id ? loaded.value : { status: 'pending' };
}
