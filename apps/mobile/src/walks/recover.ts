import { WalkRepo, type LocalWalk } from '../db/walkRepo';
import { finishLocalWalk, type LocalWalkActionDependencies } from './live';
import type { TrackingLocationPort } from './tracker';
import { WALK_LOCATION_TASK } from './task';

export interface RecoverableWalk {
  walk: LocalWalk;
  distanceM: number;
}

export interface WalkRecoveryDependencies extends LocalWalkActionDependencies {
  location: TrackingLocationPort & Pick<typeof import('expo-location'), 'hasStartedLocationUpdatesAsync'>;
}

export interface WalkRecovery {
  getSnapshot(): RecoverableWalk | null;
  subscribe(listener: () => void): () => void;
  recoverIfNeeded(): Promise<void>;
  continue(): Promise<void>;
  finish(): Promise<string>;
  dispose(): void;
}

export function createWalkRecovery(dependencies: WalkRecoveryDependencies): WalkRecovery {
  const { driver, points, tracker, location } = dependencies;
  const walks = new WalkRepo(driver);
  const listeners = new Set<() => void>();
  let snapshot: RecoverableWalk | null = null;
  let disposed = false;
  let acting = false;
  let generation = 0;
  const publish = (next: RecoverableWalk | null): void => {
    if (disposed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async recoverIfNeeded() {
      if (disposed || acting) return;
      const check = ++generation;
      const walk = walks.getLocal();
      if (walk === null) { publish(null); return; }
      const running = tracker.isForegroundRunning()
        || await location.hasStartedLocationUpdatesAsync(WALK_LOCATION_TASK);
      if (disposed || acting || check !== generation || walks.getLocal()?.id !== walk.id) return;
      publish(running ? null : { walk, distanceM: points.rebuild(walk.id).snapshot().distanceM });
    },
    async continue() {
      if (disposed || acting) return;
      acting = true;
      generation += 1;
      try {
        await tracker.restart();
        publish(null);
      } finally { acting = false; }
    },
    async finish() {
      if (disposed || acting) throw new Error('Walk recovery is unavailable');
      const walk = walks.getLocal();
      if (walk === null) throw new Error('There is no local walk to finish');
      acting = true;
      generation += 1;
      try {
        const endedAt = points.read(walk.id).at(-1)?.t ?? walk.startedAt;
        const id = await finishLocalWalk(dependencies, endedAt);
        publish(null);
        return id;
      } finally { acting = false; }
    },
    dispose() { disposed = true; snapshot = null; listeners.clear(); },
  };
}
