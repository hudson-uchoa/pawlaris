import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ReplicaProvider, useReplica } from '../useReplica';
import { replicaContext } from './support';

test('P3-2 useReplica: a subscriber renders local changes without a network call', async () => {
  const ctx = await replicaContext();
  try {
    const pet = ctx.factory.pets();
    ctx.apply.applyServerRows([{ entity: 'pets', row: pet }]);
    function PetName() {
      const name = useReplica((state) => state.pets[pet.id]?.name ?? 'Missing pet');
      return <Text>{name}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><PetName /></ReplicaProvider>);
    try {
      expect(screen.getByText('Aurora')).toBeOnTheScreen();
      await act(() => { ctx.apply.applyLocalRow('pets', { ...pet, name: 'Updated Aurora' }); });
      expect(screen.getByText('Updated Aurora')).toBeOnTheScreen();
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});

test('P3-2 useReplica: an unchanged selected value does not rerender on another slice', async () => {
  const ctx = await replicaContext();
  try {
    const pet = ctx.factory.pets();
    ctx.apply.applyServerRows([{ entity: 'pets', row: pet }]);
    let renders = 0;
    function PetName() {
      const name = useReplica((state) => state.pets[pet.id]?.name ?? 'Missing pet');
      renders += 1;
      return <Text>{name}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><PetName /></ReplicaProvider>);
    try {
      const before = renders;
      await act(() => { ctx.apply.applyLocalRow('members', ctx.factory.members()); });
      expect(renders).toBe(before);
      expect(screen.getByText('Aurora')).toBeOnTheScreen();
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});

test('P3-2 useReplica: a missing provider fails with a clear configuration error', async () => {
  function WithoutProvider() {
    const ready = useReplica((state) => state.ready);
    return <Text>{String(ready)}</Text>;
  }
  await expect(render(<WithoutProvider />)).rejects.toThrow('useReplica requires a ReplicaProvider');
});
