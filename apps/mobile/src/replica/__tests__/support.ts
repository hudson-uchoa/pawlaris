import { Kv } from '../../db/kv';
import { openDatabase } from '../../db/open';
import { OutboxRepo } from '../../db/outboxRepo';
import { ReplicaRepo } from '../../db/replicaRepo';
import { fakeClock } from '../../testing/fakeClock';
import { memoryDriver } from '../../testing/memoryDriver';
import { rowFactories } from '../../testing/rowFactories';
import { sequentialIds } from '../../testing/sequentialIds';
import { createReplicaApply } from '../apply';
import { createReplicaStore } from '../store';

export const epoch = Date.UTC(2026, 9, 13, 2, 30);

export async function replicaContext() {
  const driver = await memoryDriver();
  try {
    openDatabase(driver);
    const clock = fakeClock(epoch);
    const ids = sequentialIds();
    const factory = rowFactories(clock, ids);
    const store = createReplicaStore();
    const dependencies = { driver, store, clock };
    return {
      ...dependencies, ids, factory,
      replica: new ReplicaRepo(driver), outbox: new OutboxRepo(driver), kv: new Kv(driver),
      apply: createReplicaApply(dependencies),
    };
  } catch (error) {
    driver.close();
    throw error;
  }
}

export type ReplicaContext = Awaited<ReturnType<typeof replicaContext>>;
