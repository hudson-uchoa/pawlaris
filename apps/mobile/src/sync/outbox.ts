import type { AuthUser } from '@pawlaris/shared';
import type { Api, ApiFailure, ApiResult } from '../api/client';
import { classify } from '../api/errors';
import { DeadLetterRepo } from '../db/deadLetterRepo';
import type { SqlDriver } from '../db/driver';
import { Kv } from '../db/kv';
import { OutboxRepo, type OutboxEntry } from '../db/outboxRepo';
import type { EntityRows, SyncEntity } from '../db/replicaRepo';
import type { Clock } from '../platform/clock';
import type { Random } from '../platform/random';
import type { ReplicaApply } from '../replica/apply';
import type { SyncEvents } from './events';
import { backoff } from './backoff';

export type DrainResult = 'empty' | 'waiting' | 'signed_out';

export interface Outbox {
  readonly lastFailure: ApiFailure | null;
  drain(): Promise<DrainResult>;
  onAck(entry: OutboxEntry, row: EntityRows[SyncEntity]): void;
  reject(entry: OutboxEntry, result: ApiResult): void;
}

export interface OutboxDependencies {
  driver: SqlDriver;
  apply: ReplicaApply;
  api: Api;
  clock: Clock;
  random: Random;
  sessionUser: Pick<AuthUser, 'id'>;
  events: SyncEvents;
}

function summary(result: ApiResult): string {
  return 'networkError' in result ? 'network_error' : `HTTP ${result.status}`;
}

function retryAfter(result: ApiResult, clock: Clock): number | null {
  if ('networkError' in result || (result.status !== 429 && result.status !== 503)) return null;
  const value = Object.entries(result.headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
  if (value === undefined) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1_000;
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? null : Math.max(0, instant - clock.now());
}

export function createOutbox({ driver, apply, api, clock, random, sessionUser, events }: OutboxDependencies): Outbox {
  const outbox = new OutboxRepo(driver);
  const deadLetter = new DeadLetterRepo(driver);
  const kv = new Kv(driver);
  const effects: (() => void)[] = [];
  let lastFailure: ApiFailure | null = null;
  driver.onTransactionEnd((committed) => {
    const pending = effects.splice(0);
    if (committed) for (const effect of pending) effect();
  });

  const hasAnotherEntry = (entry: OutboxEntry): boolean => driver.all(
    'SELECT 1 FROM outbox WHERE entity = ? AND entity_id = ? AND seq != ? LIMIT 1',
    [entry.entity, entry.entityId, entry.seq],
  ).length > 0;

  const onAck = (entry: OutboxEntry, row: EntityRows[SyncEntity]): void => {
    driver.transaction(() => {
      if (row.id === entry.entityId) {
        if (!hasAnotherEntry(entry)) apply.applyAcknowledgedRow(entry.entity, row);
      } else {
        apply.removeRow(entry.entity, entry.entityId);
        outbox.removeForEntityId(entry.entityId);
        apply.applyAcknowledgedRow(entry.entity, row);
        // Only the completion route answers with a different id (04 section 10).
        const winner = row as EntityRows['task_completions'];
        effects.push(() => events.emit('completion_lost', { winner }));
      }
    });
  };

  const reject = (entry: OutboxEntry, result: ApiResult): void => {
    driver.transaction(() => {
      deadLetter.upsert({
        ...entry, status: 'networkError' in result ? 0 : result.status,
        error: summary(result), failedAt: clock.now(),
      });
      if (!hasAnotherEntry(entry)) apply.removeRow(entry.entity, entry.entityId);
      outbox.remove(entry.seq);
      const server = kv.get('active_server') ?? 'primary';
      kv.set(`last_revision.${server}`, '0');
      effects.push(() => events.emit('mutation_rejected', { entry }));
    });
  };

  return {
    get lastFailure() { return lastFailure; },
    async drain() {
      lastFailure = null;
      for (;;) {
        const entry = outbox.head(sessionUser.id);
        if (entry === null) return 'empty';
        if (entry.nextRetryAt > clock.now()) return 'waiting';
        const result = await api.request(entry.method, entry.path, entry.body, {
          'Idempotency-Key': entry.clientMutationId,
        });
        lastFailure = 'networkError' in result || !result.ok ? result : null;
        switch (classify(result, entry)) {
          case 'ok':
            driver.transaction(() => {
              // The route's successful body is its complete entity row (04 section 2).
              onAck(entry, (result as Extract<ApiResult, { ok: true }>).body as EntityRows[SyncEntity]);
              outbox.remove(entry.seq);
            });
            break;
          case 'transient':
            driver.transaction(() => {
              const serverError = !('networkError' in result) && result.status >= 500 && result.status < 600;
              const attempts = entry.attempts + 1;
              outbox.update(entry.seq, {
                attempts, serverErrors: entry.serverErrors + Number(serverError),
                nextRetryAt: clock.now() + backoff(attempts, retryAfter(result, clock), random),
                lastError: summary(result),
              });
            });
            return 'waiting';
          case 'permanent':
            reject(entry, result);
            break;
          case 'auth':
            return 'signed_out';
        }
      }
    },
    onAck,
    reject,
  };
}
