import type { ReplicaDependencies } from './apply';

export function hydrate(dependencies: ReplicaDependencies): void {
  void dependencies;
  throw new Error('Replica hydrate not implemented');
}
