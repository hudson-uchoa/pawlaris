import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import type { Uploads } from '../assets/files';
import { createEngine, type Engine, type EngineDependencies } from './engine';

export type EngineWiringDependencies = Omit<EngineDependencies,
  'serverSelect' | 'online' | 'foreground'> & { uploads?: Uploads };

export interface EngineWiring {
  engine: Engine;
  dispose(): void;
}

export function createWiredEngine(deps: EngineWiringDependencies): EngineWiring {
  let online = false;
  let foreground = AppState.currentState === 'active';
  let disposed = false;
  const engine = createEngine({
    ...deps, serverSelect: { current: () => 'primary' },
    online, foreground,
  });
  const unsubscribeNetwork = NetInfo.addEventListener((network) => {
    if (disposed) return;
    const reachable = network.isInternetReachable === true;
    if (reachable && !online) void deps.uploads?.kick();
    online = reachable;
    engine.setOnline(reachable);
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (disposed) return;
    const active = state === 'active';
    if (active && !foreground) void deps.uploads?.kick();
    foreground = active;
    engine.setForeground(active);
  });
  return {
    engine,
    dispose() {
      disposed = true;
      unsubscribeNetwork();
      appState.remove();
      engine.dispose();
      deps.uploads?.dispose();
    },
  };
}
