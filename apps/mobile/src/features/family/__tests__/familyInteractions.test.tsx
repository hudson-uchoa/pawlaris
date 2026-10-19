import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { FamilyActionError } from '../../../auth/familyActions';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { settingsContext, type SettingsContext } from '../../settings/__tests__/support';
import { FamilyScreen } from '../FamilyScreen';

let context: SettingsContext | undefined;

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

async function scene(options: Parameters<typeof settingsContext>[0] = {}) {
  const c = await settingsContext(options);
  context = c;
  const copyText = jest.fn(async (_text: string) => {});
  await render(<ReplicaProvider store={c.store}>
    <FamilyScreen services={{ ...c.services, copyText }} active />
  </ReplicaProvider>);
  return { ...c, copyText };
}

test.each(['primary', 'reserve'] as const)('R7.1 family name and timezone save online on %s', async (server) => {
  const c = await scene({ server });
  await fireEvent.changeText(screen.getByTestId('family-name'), 'Updated family');
  await fireEvent.changeText(screen.getByTestId('family-timezone'), 'Europe/Lisbon');
  await fireEvent.press(screen.getByTestId('family-save'));
  expect(c.actions.patchFamily).toHaveBeenCalledWith({ name: 'Updated family', timezone: 'Europe/Lisbon' });
  expect(c.outbox.count()).toBe(0);
});

test('09 §7 timezone choices start with Sao Paulo and search the IANA names', async () => {
  await scene();
  await fireEvent.press(screen.getByTestId('family-timezone-choose'));
  const sheet = screen.getByRole('dialog');
  expect(within(sheet).getByRole('button', { name: 'America/Sao_Paulo' })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText(strings.family.searchTimezone), 'auckland');
  await fireEvent.press(screen.getByRole('button', { name: 'Pacific/Auckland' }));
  expect(screen.getByTestId('family-timezone')).toHaveDisplayValue('Pacific/Auckland');
});

test('R7.1 invalid family names and timezones are refused before a write', async () => {
  const c = await scene();
  await fireEvent.changeText(screen.getByTestId('family-name'), 'x'.repeat(61));
  await fireEvent.press(screen.getByTestId('family-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(strings.family.invalidName);
  await fireEvent.changeText(screen.getByTestId('family-name'), 'Valid family');
  await fireEvent.changeText(screen.getByTestId('family-timezone'), 'Invalid/Zone');
  await fireEvent.press(screen.getByTestId('family-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(strings.family.invalidTimezone);
  expect(c.actions.patchFamily).not.toHaveBeenCalled();
});

test('Q-46 any member edits only their own name through the name form', async () => {
  const c = await scene({ role: 'member' });
  await fireEvent.press(within(screen.getByTestId(`member-${c.user.id}`)).getByTestId('member-name-edit'));
  await fireEvent.changeText(screen.getByTestId('member-name'), 'Changed name');
  await fireEvent.press(screen.getByTestId('member-name-save'));
  expect(c.actions.patchProfile).toHaveBeenCalledWith({ display_name: 'Changed name' });
  expect(screen.queryAllByLabelText(/colou?r/i)).toHaveLength(0);
  expect(c.outbox.count()).toBe(0);
});

test('Q-46 empty or oversized display names never leave the phone', async () => {
  const c = await scene({ role: 'member' });
  await fireEvent.press(screen.getByTestId('member-name-edit'));
  for (const value of ['', 'x'.repeat(41)]) {
    await fireEvent.changeText(screen.getByTestId('member-name'), value);
    await fireEvent.press(screen.getByTestId('member-name-save'));
    expect(screen.getByTestId('member-name')).toBeOnTheScreen();
  }
  expect(c.actions.patchProfile).not.toHaveBeenCalled();
});

test('RS-6 an already open name form disables its save when the reserve takes over', async () => {
  const c = await scene();
  await fireEvent.press(screen.getByTestId('member-name-edit'));
  await act(() => { c.setConnection({ server: 'reserve' }); });
  expect(screen.getByTestId('member-name')).toBeDisabled();
  expect(screen.getByTestId('member-name-save')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('member-name-save'));
  expect(c.actions.patchProfile).not.toHaveBeenCalled();
});

test('R7.1 an invite chooses its role, shows its code and copies it', async () => {
  const c = await scene();
  const invite = { code: '7K2M9QX4TB', role: 'leader' as const, expires_at: '2026-10-20T12:00:00Z' };
  const createInvite = jest.spyOn(c.services.actions, 'invite').mockResolvedValue(invite);
  await fireEvent.press(screen.getByTestId('invite-create'));
  await fireEvent.press(screen.getByRole('radio', { name: strings.family.roles.leader }));
  await fireEvent.press(screen.getByTestId('invite-submit'));
  expect(createInvite).toHaveBeenCalledWith('leader');
  expect(screen.getByTestId('invite-code')).toHaveTextContent(invite.code);
  expect(screen.getByText(strings.family.inviteValidity)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('invite-copy'));
  expect(c.copyText).toHaveBeenCalledWith(invite.code);
});

test('FM-1 a refused last-leader change keeps the role badge and explains the refusal', async () => {
  const c = await scene();
  c.actions.changeRole.mockRejectedValue(new FamilyActionError('last_leader'));
  await fireEvent.press(screen.getByTestId(`member-role-${c.user.id}`));
  expect(c.actions.changeRole).toHaveBeenCalledWith(c.user.id, 'member');
  expect(screen.getByRole('alert')).toHaveTextContent(strings.family.lastLeader);
  expect(screen.getByTestId(`member-role-${c.user.id}`)).toHaveProp('accessibilityState',
    expect.objectContaining({ checked: true }));
});

test('R1.20 leader removal delegates to the online member action', async () => {
  const c = await scene();
  await fireEvent.press(screen.getByTestId(`member-remove-${c.member.id}`));
  expect(c.actions.removeMember).toHaveBeenCalledWith(c.member.id);
});
