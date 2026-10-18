import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import type { Uploads } from '../assets/files';
import { createArrive, type ArriveDependencies } from './arrive';
import { createEngine, type Engine, type EngineDependencies } from './engine';
import { createPull, type Pull, type PullResult } from './pull';
import type { Server } from '../db/kv';

export type EngineWiringDependencies = Omit<EngineDependencies,
  'online' | 'foreground'> & { uploads?: Uploads; deferListeners?: boolean };

export interface EngineWiring {
  engine: Engine;
  start(): void;
  dispose(): void;
}

export type SyncEngineDependencies = Omit<EngineWiringDependencies, 'arrive' | 'pull'>
  & Omit<ArriveDependencies, 'pull'> & { prefetchAvatars?(): Promise<void> };

export function createSyncEngine(deps: SyncEngineDependencies): EngineWiring {
  const arrive = async (server: Server): Promise<PullResult> => {
    const result = await arrival.arrive(server);
    if (result === 'ok') void deps.uploads?.kick();
    return result;
  };
  const pull: Pull = createPull({ ...deps, arrive });
  const arrival = createArrive({ ...deps, pull });
  return createWiredEngine({ ...deps, arrive, pull });
}

export function createWiredEngine(deps: EngineWiringDependencies): EngineWiring {
  let online = false;
  let foreground = AppState.currentState === 'active';
  let disposed = false;
  let started = false;
  let unsubscribeNetwork: (() => void) | undefined;
  let appState: { remove(): void } | undefined;
  const engine = createEngine({
    ...deps,
    online, foreground,
  });
  const start = (): void => {
    if (started || disposed) return;
    started = true;
    foreground = AppState.currentState === 'active';
    unsubscribeNetwork = NetInfo.addEventListener((network) => {
      if (disposed) return;
      const reachable = network.isInternetReachable === true;
      if (reachable && !online) void deps.uploads?.kick();
      online = reachable;
      engine.setOnline(reachable);
    });
    appState = AppState.addEventListener('change', (state) => {
      if (disposed) return;
      const active = state === 'active';
      if (active && !foreground) void deps.uploads?.kick();
      foreground = active;
      engine.setForeground(active);
    });
  };
  if (!deps.deferListeners) start();
  return {
    engine,
    start,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeNetwork?.();
      appState?.remove();
      engine.dispose();
      deps.uploads?.dispose();
    },
  };
}
