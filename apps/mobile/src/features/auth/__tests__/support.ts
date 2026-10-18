import type { AuthUser } from '@pawlaris/shared';
import { createLifecycle } from '../../../auth/lifecycle';
import { deferred, response, servers } from '../../../auth/__tests__/support';
import type { HttpResponse } from '../../../platform/http';
import { createArrive, type Arrive } from '../../../sync/arrive';
import { createEngine } from '../../../sync/engine';
import { createPull } from '../../../sync/pull';
import { createSocket } from '../../../sync/socket';
import { syncContext } from '../../../sync/__tests__/support';
import { fakeFileSystem } from '../../../testing/fakeFileSystem';
import { fakeWebSocket } from '../../../testing/fakeWebSocket';
import type { AuthScreenServices } from '../types';

export const credentials = { email: 'family@example.invalid', password: 'test-only-password' };
export const syncEpoch = '00000000-0000-4000-8000-000000000041';

export async function authContext(options: {
  server?: 'primary' | 'reserve'; previousUser?: boolean; pendingCount?: number;
} = {}) {
  const c = await syncContext(undefined, Array.from({ length: 30 }, () => 0.5));
  const server = options.server ?? 'primary';
  if (!options.previousUser) {
    await c.session.clear('primary');
    c.kv.remove('session_user');
  }
  c.kv.set('active_server', server);
  c.kv.set(`signed_out.${server}`, '1');
  const pet = c.factory.pets({ id: c.factory.petId, created_by: c.sessionUser.id, revision: null });
  if ((options.pendingCount ?? 0) > 0) {
    c.driver.transaction(() => {
      c.apply.applyLocalRow('pets', pet);
      for (let index = 0; index < (options.pendingCount ?? 0); index += 1) {
        c.outbox.insert(c.factory.outbox({ userId: c.sessionUser.id, entityId: pet.id,
          method: 'PATCH', path: `/pets/${pet.id}`, body: { name: pet.name } }));
      }
    });
  }
  const fileSystem = fakeFileSystem();
  const transport = fakeWebSocket();
  const arrive: Arrive['arrive'] = (target) => arrival.arrive(target);
  const pull = createPull({ ...c, arrive });
  const arrival = createArrive({ ...c, pull, fileSystem, logRejectedRow: jest.fn() });
  const engine = createEngine({ ...c, arrive, pull, outbox: c.drain, online: true, foreground: true,
    createSocket(target, onRevision) {
      return createSocket({ ...c, WebSocketImpl: transport.WebSocketImpl,
        url: `${servers[target].replace(/^https/, 'wss')}/ws`,
        session: { accessToken: () => c.session.accessToken(target), refresh: () => c.session.refresh(target) },
        lastRevision: () => Number(c.kv.get(`last_revision.${target}`) ?? 0), onRevision });
    },
  });
  const kick = jest.fn((reason: 'login') => engine.kick(reason));
  const removeAssetFiles = jest.fn(async () => {});
  const cancelNotifications = jest.fn(async () => {});
  const stopTracking = jest.fn(async () => {});
  const lifecycle = createLifecycle({ ...c, activeServer: c.serverSelect.current,
    kick, removeAssetFiles, cancelNotifications, stopTracking });
  const services: AuthScreenServices = {
    session: c.session, lifecycle, connection: engine.state,
    sessionUser() {
      const stored = c.kv.get('session_user');
      return stored === null ? null : JSON.parse(stored) as AuthUser;
    },
  };
  const family = c.factory.family({ id: c.sessionUser.family_id });
  const page = { changes: [{ entity: 'family', row: family }], revision: 1,
    has_more: false, epoch: syncEpoch };
  function queueArrival() {
    // Epoch read, full pull, then the engine's ordinary incremental pull.
    c.http.enqueue(response(200, page), response(200, page), response(200, { ...page, changes: [] }));
  }
  return { ...c, services, engine, kick, family, pet, page, queueArrival, fileSystem, transport,
    removeAssetFiles, cancelNotifications, stopTracking,
    pendingReply: () => deferred<HttpResponse>(),
    dispose() { engine.dispose(); c.driver.close(); },
  };
}

export type AuthContext = Awaited<ReturnType<typeof authContext>>;
