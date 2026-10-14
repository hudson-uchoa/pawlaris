import type { Engine, EngineDependencies } from './engine';

export type EngineWiringDependencies = Omit<EngineDependencies,
  'serverSelect' | 'online' | 'foreground'>;

export interface EngineWiring {
  engine: Engine;
  dispose(): void;
}

export function createWiredEngine(deps: EngineWiringDependencies): EngineWiring {
  void deps;
  throw new Error('Engine wiring not implemented');
}
