import { localDate, localTime, slotInstant } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import recurrence from '../../../../../../spec/fixtures/recurrence-vectors.json';
import time from '../../../../../../spec/fixtures/time-vectors.json';
import { response, servers } from '../../../auth/__tests__/support';
import { checkDiagnosticsHealth } from '../../../diagnostics';
import { strings } from '../../../i18n/strings';
import { formatDateTime } from '../../../i18n/format';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { DiagnosticsScreen } from '../DiagnosticsScreen';
import { exportLogs } from '../exportLogs';
import { runSelfTest } from '../selfTest';
import { settingsContext, type SettingsContext } from './support';

let context: SettingsContext | undefined;
const total = recurrence.vectors.length + time.localDate.length + time.localTime.length + time.slotInstant.length;

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
});

afterEach(async () => {
  await cleanup();
  context?.dispose();
  context = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function scene() {
  const c = await settingsContext();
  context = c;
  return c;
}

async function paint(c: SettingsContext) {
  return render(<ReplicaProvider store={c.store}>
    <DiagnosticsScreen services={c.diagnosticServices} active />
  </ReplicaProvider>);
}

test('R7.4 RC-3 Autoteste reports n/n ok for both fixture files without HTTP', async () => {
  const c = await scene();
  await paint(c);
  await fireEvent.press(screen.getByTestId('diag-selftest'));
  expect(screen.getByTestId('diag-selftest-result')).toHaveTextContent(strings.settings.selfTestResult(total, total));
  expect(c.http.requests).toEqual([]);
});

test('R7.4 RC-3 Autoteste names a failing vector when the recurrence engine is wrong', async () => {
  const c = await scene();
  c.diagnosticServices.selfTest = () => runSelfTest({ occurrences: () => [], localDate, localTime, slotInstant });
  await paint(c);
  await fireEvent.press(screen.getByTestId('diag-selftest'));
  const failing = recurrence.vectors.filter((vector) => vector.expect.length > 0);
  const result = screen.getByTestId('diag-selftest-result');
  expect(within(result).getByText(strings.settings.selfTestResult(total - failing.length, total))).toBeOnTheScreen();
  for (const vector of failing) expect(within(result).getByText(vector.name)).toBeOnTheScreen();
});

test('R7.2 diagnostics reads local counts and dead letters, and follows the active server', async () => {
  const c = await scene();
  const rejected = c.factory.deadLetter({ body: { password: 'test-only-hidden-body' } });
  c.driver.transaction(() => { c.deadLetter.upsert(rejected); });
  c.kv.set('last_revision.primary', '17');
  c.kv.set('last_revision.reserve', '23');
  c.driver.transaction(() => {
    for (const state of ['to_upload', 'uploaded', 'downloaded', 'failed']) {
      c.driver.run('INSERT INTO asset_file (id, kind, state, created_at) VALUES (?, ?, ?, ?)',
        [c.ids.uuid(), 'task_proof', state, c.clock.now()]);
    }
  });
  await act(() => { c.setConnection({ outboxCount: 2 }); });
  await paint(c);
  for (const [id, value] of [['revision', '17'], ['outbox', '2'], ['uploads', '1'],
    ['camera', strings.diagnostics.granted], ['health', strings.diagnostics.healthy]] as const) {
    expect(within(screen.getByTestId(`diag-${id}`)).getByText(value)).toBeOnTheScreen();
  }
  for (const id of ['notifications', 'location', 'background-location', 'normal-channel', 'critical-channel', 'battery']) {
    expect(within(screen.getByTestId(`diag-${id}`)).getByText(strings.diagnostics.unavailable)).toBeOnTheScreen();
  }
  expect(screen.getByTestId('diag-version')).toBeOnTheScreen();
  expect(screen.getByTestId('diag-build')).toBeOnTheScreen();
  expect(screen.queryByTestId(`diag-dead-letter-${rejected.clientMutationId}`)).toBeNull();
  await fireEvent.press(screen.getByTestId('diag-dead-letters'));
  const entry = within(screen.getByTestId(`diag-dead-letter-${rejected.clientMutationId}`));
  expect(entry.getByText(`${rejected.method} ${rejected.path}`)).toBeOnTheScreen();
  expect(entry.getByText(`${rejected.status} · ${rejected.error}`)).toBeOnTheScreen();
  expect(entry.getByText(formatDateTime(rejected.failedAt, c.family.timezone))).toBeOnTheScreen();
  expect(screen.queryByText('test-only-hidden-body')).toBeNull();
  await act(() => { c.setConnection({ server: 'reserve' }); });
  expect(within(screen.getByTestId('diag-revision')).getByText('23')).toBeOnTheScreen();
  expect(within(screen.getByTestId('diag-connection')).getByText(strings.sync.synced + strings.sync.reserveSuffix))
    .toBeOnTheScreen();
});

test('R7.2 diagnostics renders before camera and API probes resolve', async () => {
  const c = await scene();
  c.diagnosticServices.camera.getPermission = () => new Promise<boolean>(() => {});
  c.diagnosticServices.checkHealth = () => new Promise<boolean>(() => {});
  await paint(c);
  expect(screen.getByTestId('diag-revision')).toBeOnTheScreen();
  expect(within(screen.getByTestId('diag-camera')).getByText(strings.diagnostics.unchecked)).toBeOnTheScreen();
  expect(within(screen.getByTestId('diag-health')).getByText(strings.diagnostics.unchecked)).toBeOnTheScreen();
  expect(screen.getByTestId('diag-selftest')).toBeEnabled();
});

test('R7.4 diagnostics kicks refresh and delegates rebuilding while retaining queued changes', async () => {
  const c = await scene();
  c.mutations.createPet({ name: 'Atlas', species: 'cat' });
  await paint(c);
  await fireEvent.press(screen.getByTestId('diag-sync'));
  expect(c.diagnosticServices.engine.kick).toHaveBeenCalledTimes(1);
  expect(c.diagnosticServices.engine.kick).toHaveBeenCalledWith('refresh');
  await fireEvent.press(screen.getByTestId('diag-rebuild'));
  expect(c.diagnosticServices.rebuild).toHaveBeenCalledTimes(1);
  expect(c.outbox.count()).toBe(1);
});

test('R7.4 offline diagnostics disables sync and rebuild but allows local self-test and export', async () => {
  const c = await scene();
  await act(() => { c.setConnection({ status: 'offline' }); });
  await paint(c);
  for (const id of ['diag-sync', 'diag-rebuild']) {
    expect(screen.getByTestId(id)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(id));
  }
  expect(c.diagnosticServices.engine.kick).not.toHaveBeenCalled();
  expect(c.diagnosticServices.rebuild).not.toHaveBeenCalled();
  expect(c.diagnosticServices.checkHealth).not.toHaveBeenCalled();
  expect(screen.getByTestId('diag-selftest')).toBeEnabled();
  expect(screen.getByTestId('diag-export')).toBeEnabled();
});

test.each(['primary', 'reserve'] as const)('R7.2 API health checks %s without credentials and rejects unhealthy responses', async (server) => {
  const c = await scene();
  c.setConnection({ server });
  c.http.enqueue(response(200, { status: 'ok', role: server }),
    response(200, { status: 'ok', role: server === 'primary' ? 'reserve' : 'primary' }),
    response(503, { status: 'ok', role: server }), new Error('Test network failure'));
  expect(await checkDiagnosticsHealth(c.http, servers, c.services.connection)).toBe(true);
  for (let index = 0; index < 3; index += 1) {
    expect(await checkDiagnosticsHealth(c.http, servers, c.services.connection)).toBe(false);
  }
  expect(c.http.requests).toEqual(Array.from({ length: 4 }, () => ({
    method: 'GET', url: `${servers[server]}/health`, timeoutMs: 15_000,
  })));
});

// Synthetic canaries are intentionally unsafe input to the export boundary.
const canaries = { access: 'test-only-access-canary', refresh: 'test-only-refresh-canary', password: 'test-only-password-canary' };
const currentLog = `${JSON.stringify({ event: 'sync_finished', status: 200,
  Authorization: `Bearer ${canaries.access}`, refresh_token: canaries.refresh, password: canaries.password })}\n`;
const previousLog = `${JSON.stringify({ event: 'sync_started',
  detail: `Bearer ${canaries.access}`, current_password: canaries.password, new_password: canaries.password })}\n`;

function assertSafeExport(c: SettingsContext) {
  expect(c.shareText).toHaveBeenCalledTimes(1);
  const call = c.shareText.mock.calls[0];
  expect(call).toBeDefined();
  const [filename, text] = call ?? ['', ''];
  expect(filename).toMatch(/\.txt$/);
  expect(text).toContain('sync_started');
  expect(text).toContain('sync_finished');
  expect(text.indexOf('sync_started')).toBeLessThan(text.indexOf('sync_finished'));
  expect(text).not.toMatch(/Bearer/i);
  for (const canary of Object.values(canaries)) expect(text).not.toContain(canary);
}

test('R7.3 R1.7 exporting the real logger archive and active log removes all credential canaries', async () => {
  const c = await scene();
  c.seedLogs(currentLog, previousLog);
  await exportLogs(c.logger, c.diagnosticServices.share);
  assertSafeExport(c);
});

test('R7.3 Exportar registros shares a redacted text file through the Diagnostics action', async () => {
  const c = await scene();
  c.seedLogs(currentLog, previousLog);
  await paint(c);
  expect(c.shareText).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('diag-export'));
  assertSafeExport(c);
});
