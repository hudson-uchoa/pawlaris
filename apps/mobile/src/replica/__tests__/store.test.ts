import { hydrate } from '../hydrate';
import { createReplicaStore } from '../store';
import { replicaContext } from './support';

test('P3-2 store: a fresh store is empty and not ready, with no UI setter', () => {
  const store = createReplicaStore();
  expect(store.getState()).toEqual({
    ready: false, family: null, members: {}, pets: {}, weightEntries: {}, healthEvents: {},
    taskTemplates: {}, completions: {}, timers: {}, walks: {}, assets: {}, pending: {},
  });
  expect(store.getInitialState()).toBe(store.getState());
  expect('setState' in store).toBe(false);
});

test('P3-2 hydrate: an empty database becomes ready synchronously with one notification', async () => {
  const ctx = await replicaContext();
  try {
    const listener = jest.fn();
    const unsubscribe = ctx.store.subscribe(listener);
    expect(hydrate(ctx)).toBeUndefined();
    expect(ctx.store.getState().ready).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    ctx.apply.applyLocalRow('pets', ctx.factory.pets());
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    ctx.driver.close();
  }
});

test('P3-2 store: independent stores never share rows or subscribers', async () => {
  const ctx = await replicaContext();
  try {
    const other = createReplicaStore();
    const listener = jest.fn();
    const unsubscribe = other.subscribe(listener);
    ctx.apply.applyLocalRow('pets', ctx.factory.pets());
    expect(other.getState().pets).toEqual({});
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  } finally {
    ctx.driver.close();
  }
});
