import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { createEngine, type Engine, type EngineDependencies } from './engine';

export type EngineWiringDependencies = Omit<EngineDependencies,
  'serverSelect' | 'online' | 'foreground'>;

export interface EngineWiring {
  engine: Engine;
  dispose(): void;
}

export function createWiredEngine(deps: EngineWiringDependencies): EngineWiring {
  const engine = createEngine({
    ...deps, serverSelect: { current: () => 'primary' },
    online: false, foreground: AppState.currentState === 'active',
  });
  const unsubscribeNetwork = NetInfo.addEventListener((network) => {
    engine.setOnline(network.isInternetReachable === true);
  });
  const appState = AppState.addEventListener('change', (state) => {
    engine.setForeground(state === 'active');
  });
  return {
    engine,
    dispose() {
      unsubscribeNetwork();
      appState.remove();
      engine.dispose();
    },
  };
}
