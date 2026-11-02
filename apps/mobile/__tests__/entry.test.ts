test('P6-2 defines the walk location task before loading the router entry', () => {
  const callOrder: string[] = [];

  jest.isolateModules(() => {
    jest.doMock('expo-task-manager', () => ({
      defineTask: jest.fn((taskName: string) => { callOrder.push(taskName); }),
    }));
    jest.doMock('expo-notifications', () => ({
      registerTaskAsync: jest.fn((taskName: string) => {
        callOrder.push(`register:${taskName}`);
        return Promise.resolve(null);
      }),
    }));
    jest.doMock('expo-router/entry', () => {
      callOrder.push('expo-router/entry');
      return {};
    });

    jest.requireActual('../index');
  });

  expect(callOrder).toEqual([
    'pawlaris.walk-location', 'pawlaris.push', 'register:pawlaris.push',
    'expo-router/entry',
  ]);
});
