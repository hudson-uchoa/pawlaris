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
  return {
    on(_event, _listener) { throw new Error('not implemented'); },
    emit(_event, _payload) { throw new Error('not implemented'); },
  };
}
