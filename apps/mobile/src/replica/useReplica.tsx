import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ReplicaState, ReplicaStore } from './store';

export interface ReplicaProviderProps {
  store: ReplicaStore;
  children: ReactNode;
}

const ReplicaContext = createContext<ReplicaStore | null>(null);

export function ReplicaProvider(props: ReplicaProviderProps): ReactNode {
  return <ReplicaContext.Provider value={props.store}>{props.children}</ReplicaContext.Provider>;
}

export function useReplica<T>(selector: (state: ReplicaState) => T): T {
  const store = useContext(ReplicaContext);
  if (store === null) throw new Error('useReplica requires a ReplicaProvider');
  return useStore(store, selector);
}
