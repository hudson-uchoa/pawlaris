import type { ReactNode } from 'react';
import type { ReplicaState, ReplicaStore } from './store';

export interface ReplicaProviderProps {
  store: ReplicaStore;
  children: ReactNode;
}

export function ReplicaProvider(props: ReplicaProviderProps): ReactNode {
  void props;
  throw new Error('Replica provider not implemented');
}

export function useReplica<T>(selector: (state: ReplicaState) => T): T {
  void selector;
  throw new Error('Replica hook not implemented');
}
