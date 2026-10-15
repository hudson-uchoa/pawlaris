import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

function subscribe(onChange: () => void): () => void {
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}

function snapshot(): string | null | undefined {
  return AppState.currentState;
}

// Screen owners supply their focus state; the app lifecycle also gates motion.
export function useAnimationActive(active: boolean): boolean {
  return useSyncExternalStore(subscribe, snapshot) === 'active' && active;
}
