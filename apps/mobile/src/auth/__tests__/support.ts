import { Kv, type Server } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { OutboxRepo } from '../../db/outboxRepo';
import { ReplicaRepo } from '../../db/replicaRepo';
import type { HttpResponse } from '../../platform/http';
import { fakeClock } from '../../testing/fakeClock';
import { fakeHttp } from '../../testing/fakeHttp';
import { fakeSecretBox } from '../../testing/fakeSecretBox';
import { memoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { createSession, type WireSession } from '../session';

export const epoch = Date.UTC(2026, 9, 13, 12);
export const servers = {
  primary: 'https://primary.pawlaris.invalid/api/v1',
  reserve: 'https://reserve.pawlaris.invalid/api/v1',
};

export function wireSession(server: Server, generation = 'initial', remaining = 900_000): WireSession {
  return {
    access_token: `fake-${server}-access-${generation}`,
    refresh_token: `fake-${server}-refresh-${generation}`,
    access_expires_at: new Date(epoch + remaining).toISOString(),
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      family_id: '00000000-0000-4000-8000-000000000002',
      email: 'family@example.invalid', display_name: 'Test member',
      role: 'leader', color: '#5B7DB1',
    },
  };
}

export function response(status: number, body: unknown = null): HttpResponse {
  return { status, body, headers: {} };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred promise is not initialized'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

export async function sessionContext() {
  const driver = await memoryDriver();
  openDatabase(driver);
  const clock = fakeClock(epoch);
  const http = fakeHttp();
  const secretBox = fakeSecretBox();
  const kv = new Kv(driver);
  let server: Server = 'primary';
  const dependencies = { http, secretBox, clock, kv, servers, activeServer: () => server };
  const factory = rowFactories(clock, sequentialIds());
  return {
    ...dependencies, driver, factory,
    outbox: new OutboxRepo(driver), replica: new ReplicaRepo(driver),
    select(next: Server) { server = next; },
    makeSession: () => createSession(dependencies),
  };
}

export type SessionContext = Awaited<ReturnType<typeof sessionContext>>;
