import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { shallow } from 'zustand/shallow';
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
  const cache = useRef<{
    state: ReplicaState;
    selector: (state: ReplicaState) => T;
    value: T;
  } | undefined>(undefined);
  const select = useCallback((state: ReplicaState): T => {
    const previous = cache.current;
    if (previous !== undefined && previous.state === state && previous.selector === selector) {
      return previous.value;
    }
    const selected = selector(state);
    const value = previous !== undefined && shallow(previous.value, selected) ? previous.value : selected;
    cache.current = { state, selector, value };
    return value;
  }, [selector]);
  return useStore(store, select);
}
