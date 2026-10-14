import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { selectDayView, selectPet, selectPets } from '../selectors';
import type { ReplicaState } from '../store';
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

test('RP-4: selectPets renders a built list without looping', async () => {
  const ctx = await replicaContext();
  try {
    ctx.apply.applyServerRows([{ entity: 'pets', row: ctx.factory.pets() }]);
    function PetList() {
      const pets = useReplica(selectPets);
      return <Text>{pets.map((pet) => pet.name).join(', ')}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><PetList /></ReplicaProvider>);
    try {
      expect(screen.getByText('Aurora')).toBeOnTheScreen();
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});

test('RP-4: an inline day view renders a built value without looping', async () => {
  const ctx = await replicaContext();
  try {
    ctx.apply.applyServerRows([
      { entity: 'family', row: ctx.factory.family() },
      { entity: 'pets', row: ctx.factory.pets({ id: ctx.factory.petId }) },
      { entity: 'task_templates', row: ctx.factory.task_templates({ id: ctx.factory.taskId }) },
    ]);
    const options = {
      date: '2026-10-13' as const, now: ctx.clock.now(), me: ctx.factory.memberId, scope: 'mine' as const,
    };
    function DayView() {
      const view = useReplica((state) => selectDayView(state, options));
      return <Text testID="day-view">{JSON.stringify(view)}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><DayView /></ReplicaProvider>);
    try {
      expect(screen.getByTestId('day-view'))
        .toHaveTextContent(JSON.stringify(selectDayView(ctx.store.getState(), options)));
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});

test('RP-4: changing a pet rerenders selectPets with the new list', async () => {
  const ctx = await replicaContext();
  try {
    const pet = ctx.factory.pets();
    ctx.apply.applyServerRows([{ entity: 'pets', row: pet }]);
    let renders = 0;
    function PetList() {
      const pets = useReplica(selectPets);
      renders += 1;
      return <Text>{pets.map((row) => row.name).join(', ')}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><PetList /></ReplicaProvider>);
    try {
      const before = renders;
      await act(() => { ctx.apply.applyLocalRow('pets', { ...pet, name: 'Updated Aurora' }); });
      expect(renders).toBeGreaterThan(before);
      expect(screen.getByText('Updated Aurora')).toBeOnTheScreen();
      expect(screen.queryByText('Aurora')).toBeNull();
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});

test('RP-4: changing another slice does not rerender selectPets', async () => {
  const ctx = await replicaContext();
  try {
    ctx.apply.applyServerRows([{ entity: 'pets', row: ctx.factory.pets() }]);
    let renders = 0;
    function PetList() {
      const pets = useReplica(selectPets);
      renders += 1;
      return <Text>{pets.map((pet) => pet.name).join(', ')}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><PetList /></ReplicaProvider>);
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

test('RP-4: a changed captured argument selects its new value without a state change', async () => {
  const ctx = await replicaContext();
  try {
    const first = ctx.factory.pets();
    const second = ctx.factory.pets({ name: 'Luna' });
    ctx.apply.applyServerRows([{ entity: 'pets', row: first }, { entity: 'pets', row: second }]);
    const state = ctx.store.getState();
    const select = jest.fn((snapshot: ReplicaState, id: string) => selectPet(snapshot, id));
    function PetName({ id }: { id: string }) {
      const pet = useReplica((snapshot) => select(snapshot, id));
      return <Text>{pet?.name ?? 'Missing pet'}</Text>;
    }
    const rendered = await render(
      <ReplicaProvider store={ctx.store}><PetName id={first.id} /></ReplicaProvider>,
    );
    try {
      expect(screen.getByText('Aurora')).toBeOnTheScreen();
      expect(select).toHaveBeenCalledTimes(1);
      await rendered.rerender(
        <ReplicaProvider store={ctx.store}><PetName id={second.id} /></ReplicaProvider>,
      );
      expect(screen.getByText('Luna')).toBeOnTheScreen();
      expect(screen.queryByText('Aurora')).toBeNull();
      expect(select).toHaveBeenCalledTimes(2);
      expect(ctx.store.getState()).toBe(state);
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});

test('RP-4: a stable selector runs once per state and retains shallowly equal results', async () => {
  const ctx = await replicaContext();
  try {
    const pet = ctx.factory.pets();
    ctx.apply.applyServerRows([{ entity: 'pets', row: pet }]);
    const selector = jest.fn((state: ReplicaState) => selectPets(state));
    let selected: ReturnType<typeof selectPets> | undefined;
    function PetList() {
      const pets = useReplica(selector);
      selected = pets;
      return <Text>{pets.map((row) => row.name).join(', ')}</Text>;
    }
    const rendered = await render(<ReplicaProvider store={ctx.store}><PetList /></ReplicaProvider>);
    try {
      const first = selected;
      expect(selector).toHaveBeenCalledTimes(1);
      await rendered.rerender(<ReplicaProvider store={ctx.store}><PetList /></ReplicaProvider>);
      expect(selector).toHaveBeenCalledTimes(1);
      expect(selected).toBe(first);

      await act(() => { ctx.apply.applyLocalRow('members', ctx.factory.members()); });
      expect(selector).toHaveBeenCalledTimes(2);
      await rendered.rerender(<ReplicaProvider store={ctx.store}><PetList /></ReplicaProvider>);
      expect(selector).toHaveBeenCalledTimes(2);
      expect(selected).toBe(first);

      await act(() => { ctx.apply.applyLocalRow('pets', { ...pet, name: 'Updated Aurora' }); });
      expect(selector).toHaveBeenCalledTimes(3);
      expect(selected).not.toBe(first);
      expect(selected).toEqual([{ ...pet, name: 'Updated Aurora' }]);
    } finally {
      await rendered.unmount();
    }
  } finally {
    ctx.driver.close();
  }
});
