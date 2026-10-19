import { localDate, localTime, slotInstant } from '@pawlaris/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import recurrence from '../../../../../../spec/fixtures/recurrence-vectors.json';
import time from '../../../../../../spec/fixtures/time-vectors.json';
import { strings } from '../../../i18n/strings';
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
  expect(result).toHaveTextContent(strings.settings.selfTestResult(total - failing.length, total));
  for (const vector of failing) expect(result).toHaveTextContent(vector.name);
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
