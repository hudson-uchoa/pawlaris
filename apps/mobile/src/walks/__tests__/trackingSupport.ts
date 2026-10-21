import type { WalkPoint } from '@pawlaris/shared';
import type { LocationObject } from 'expo-location';
import { Kv } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { OutboxRepo } from '../../db/outboxRepo';
import { WalkRepo } from '../../db/walkRepo';
import { createReplicaApply } from '../../replica/apply';
import { createReplicaStore } from '../../replica/store';
import { createMutations } from '../../sync/mutations';
import { fakeClock } from '../../testing/fakeClock';
import { memoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { createPointStore } from '../pointStore';

export async function trackingStorage(data?: Uint8Array) {
  const driver = await memoryDriver(data);
  openDatabase(driver);
  const clock = fakeClock(Date.parse('2026-10-21T15:00:00Z'));
  const ids = sequentialIds();
  const factory = rowFactories(clock, ids);
  const store = createReplicaStore();
  const apply = createReplicaApply({ driver, store, clock });
  const pet = factory.pets({ id: factory.petId, species: 'dog' });
  apply.applyServerRows([{ entity: 'pets', row: pet }]);
  const mutations = createMutations({ driver, apply, clock, ids,
    sessionUser: { id: factory.memberId }, kick() {} });
  return { driver, clock, store, mutations, pet,
    userId: factory.memberId, kv: new Kv(driver), walks: new WalkRepo(driver),
    outbox: new OutboxRepo(driver), points: createPointStore(driver) };
}

export function trackPoint(t: number, index = 0, paused = false): WalkPoint {
  return { lat: -23.55 + index * 0.0001, lon: -46.63, t, acc: 4, paused };
}

export function locationFix(point: WalkPoint): LocationObject {
  return { timestamp: point.t, coords: {
    latitude: point.lat, longitude: point.lon, accuracy: point.acc,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null,
  } };
}
