import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { settingsContext, type SettingsContext } from '../../settings/__tests__/support';
import { accountAvailability, type AccountAction } from '../accountAvailability';
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
  await render(<ReplicaProvider store={c.store}><FamilyScreen services={c.services} active /></ReplicaProvider>);
  return c;
}

test('R7.1 R1.16 a member can edit their own name but sees no invite, role, remove or timezone controls', async () => {
  const c = await scene({ role: 'member' });
  expect(screen.getByText(c.family.name)).toBeOnTheScreen();
  expect(screen.getByText(c.family.timezone)).toBeOnTheScreen();
  for (const member of Object.values(c.store.getState().members)) {
    expect(screen.getByTestId(`member-${member.id}`)).toHaveTextContent(member.display_name);
  }
  for (const id of ['invite-create', 'family-timezone', 'family-save']) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
  expect(screen.queryAllByTestId(/^member-(role|remove)-/)).toHaveLength(0);
  const editName = within(screen.getByTestId(`member-${c.user.id}`)).getByTestId('member-name-edit');
  expect(editName).toHaveTextContent(strings.settings.editName);
  expect(editName).not.toBeDisabled();
  expect(screen.getAllByTestId('member-name-edit')).toHaveLength(1);
  expect(c.http.requests).toEqual([]);
});

test('R7.1 offline family administration is disabled with its note and sends no write', async () => {
  const c = await scene({ status: 'offline' });
  expect(screen.getByTestId('offline-note')).toHaveTextContent(strings.settings.offlineNote);
  for (const id of ['invite-create', 'family-name', 'family-timezone', 'family-save',
    `member-role-${c.member.id}`, `member-remove-${c.member.id}`, 'member-name-edit']) {
    expect(screen.getByTestId(id)).toBeDisabled();
  }
  for (const id of ['invite-create', 'family-save', `member-role-${c.member.id}`, `member-remove-${c.member.id}`,
    'member-name-edit']) {
    await fireEvent.press(screen.getByTestId(id));
  }
  for (const action of Object.values(c.actions)) expect(action).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
  expect(c.outbox.count()).toBe(0);
});

test('RS-6 reserve disables account controls with reserve-note but keeps family name and timezone editable', async () => {
  const c = await scene({ server: 'reserve' });
  expect(screen.getByTestId('reserve-note')).toHaveTextContent(strings.settings.reserveNote);
  for (const id of ['invite-create', `member-role-${c.member.id}`, `member-remove-${c.member.id}`,
    'member-name-edit']) {
    expect(screen.getByTestId(id)).toBeDisabled();
  }
  for (const id of ['family-name', 'family-timezone', 'family-save']) {
    expect(screen.getByTestId(id)).not.toBeDisabled();
  }
  await fireEvent.changeText(screen.getByTestId('family-name'), 'Updated family');
  expect(screen.getByTestId('family-name')).toHaveDisplayValue('Updated family');
  for (const id of ['invite-create', `member-role-${c.member.id}`, `member-remove-${c.member.id}`, 'member-name-edit']) {
    await fireEvent.press(screen.getByTestId(id));
  }
  expect(c.actions.invite).not.toHaveBeenCalled();
  expect(c.actions.changeRole).not.toHaveBeenCalled();
  expect(c.actions.removeMember).not.toHaveBeenCalled();
  expect(c.actions.patchProfile).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test.each([
  ['synced', 'primary', 'available'], ['offline', 'primary', 'offline'], ['synced', 'reserve', 'reserve'],
] as const)('RS-6 the five Settings account controls are %s on %s with availability %s', (status, server, expected) => {
  const actions: AccountAction[] = ['invite', 'name', 'password', 'role', 'remove'];
  for (const action of actions) {
    expect(accountAvailability(action, { status, server, outboxCount: 0 })).toBe(expected);
  }
});
