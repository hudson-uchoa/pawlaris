import type { Completion } from '@pawlaris/shared';
import type { OutboxEntry } from '../db/outboxRepo';

export interface SyncEventPayloads {
  completion_lost: { winner: Completion };
  mutation_rejected: { entry: OutboxEntry };
}

export interface SyncEvents {
  on<E extends keyof SyncEventPayloads>(
    event: E, listener: (payload: SyncEventPayloads[E]) => void,
  ): () => void;
  emit<E extends keyof SyncEventPayloads>(event: E, payload: SyncEventPayloads[E]): void;
}

export function createSyncEvents(): SyncEvents {
  const listeners: {
    [E in keyof SyncEventPayloads]: Set<(payload: SyncEventPayloads[E]) => void>
  } = { completion_lost: new Set(), mutation_rejected: new Set() };
  return {
    on(event, listener) {
      listeners[event].add(listener);
      return () => { listeners[event].delete(listener); };
    },
    emit(event, payload) {
      for (const listener of [...listeners[event]]) listener(payload);
    },
  };
}
