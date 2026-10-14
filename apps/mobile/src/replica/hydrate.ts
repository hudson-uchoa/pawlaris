import { hydrateReplica, type ReplicaDependencies } from './apply';

export function hydrate(dependencies: ReplicaDependencies): void {
  hydrateReplica(dependencies);
}
