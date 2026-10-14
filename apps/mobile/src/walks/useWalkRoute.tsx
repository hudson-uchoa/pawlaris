import { createContext, type ReactNode } from 'react';
import type { WalkRouteResult, WalkRoutes } from './routes';

export type WalkRouteState = WalkRouteResult | { status: 'pending'; points?: undefined };
export const WalkRoutesContext = createContext<WalkRoutes | null>(null);

export function WalkRoutesProvider(props: { routes: WalkRoutes; children?: ReactNode }): ReactNode {
  return <WalkRoutesContext.Provider value={props.routes}>{props.children}</WalkRoutesContext.Provider>;
}

export function useWalkRoute(id: string): WalkRouteState {
  void id;
  throw new Error('not implemented');
}
