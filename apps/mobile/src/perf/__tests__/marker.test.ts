import { createStartupMarker } from '../marker';

test('startup marker stays silent until the dashboard reports its first data layout', () => {
  const output = jest.fn();
  const marker = createStartupMarker(output);
  expect(output).not.toHaveBeenCalled();
  marker.dashboardInteractive();
  expect(output).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledWith('PAWLARIS_PERF dashboard_interactive');
});

test('startup marker emits once across repeated dashboard layouts', () => {
  const output = jest.fn();
  const marker = createStartupMarker(output);
  marker.dashboardInteractive();
  marker.dashboardInteractive();
  marker.dashboardInteractive();
  expect(output).toHaveBeenCalledTimes(1);
});

test('a new launch gets its own startup marker', () => {
  const output = jest.fn();
  createStartupMarker(output).dashboardInteractive();
  createStartupMarker(output).dashboardInteractive();
  expect(output).toHaveBeenCalledTimes(2);
});
