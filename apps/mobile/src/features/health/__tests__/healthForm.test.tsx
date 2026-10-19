import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { formatDateTime, formatFullDate, formatValidationError } from '../../../i18n/format';
import { strings } from '../../../i18n/strings';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { petContext, type PetContext } from '../../pets/__tests__/support';
import { HealthDetailScreen } from '../HealthDetailScreen';
import { HealthFormScreen } from '../HealthFormScreen';

let context: PetContext | undefined;

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
  const c = await petContext();
  context = c;
  const pet = c.seedPet();
  return { c, pet };
}

async function paint(c: PetContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>{children}</AssetFilesProvider>
  </ReplicaProvider>);
}

function form(c: PetContext, petId: string) {
  return <HealthFormScreen petId={petId} services={c} active onClose={c.onClose} onAttachment={jest.fn()} />;
}

test('R2.10 the shared validator refuses missing fields and an 81-character title locally', async () => {
  const { c, pet } = await scene();
  const create = jest.spyOn(c.mutations, 'createHealthEvent');
  await paint(c, form(c, pet.id));
  expect(screen.queryByTestId('health-delete')).toBeNull();
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(screen.getAllByRole('alert').map((alert) => alert.props.children)).toEqual([
    formatValidationError({ field: 'type', code: 'required' }),
    formatValidationError({ field: 'title', code: 'required' }),
  ]);
  await fireEvent.press(screen.getByRole('radio', { name: strings.health.types.vaccine }));
  await fireEvent.changeText(screen.getByTestId('health-title'), 'A'.repeat(81));
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(formatValidationError({ field: 'title', code: 'out_of_range' }));
  expect(create).not.toHaveBeenCalled();
  expect(c.outbox.count()).toBe(0);
  expect(c.onClose).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test.each(['vaccine', 'medication', 'vet_visit', 'symptom', 'procedure', 'other'] as const)(
  'R2.9 R2.10 %s saves once with the injected instant and optional fields absent', async (type) => {
    const { c, pet } = await scene();
    c.clock.advance(12_543);
    const create = jest.spyOn(c.mutations, 'createHealthEvent');
    await paint(c, form(c, pet.id));
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByTestId('health-occurred-at')).toHaveDisplayValue(formatDateTime(c.clock.now(), 'America/Sao_Paulo'));
    await fireEvent.press(screen.getByRole('radio', { name: strings.health.types[type] }));
    await fireEvent.changeText(screen.getByTestId('health-title'), 'Routine care');
    await fireEvent.press(screen.getByTestId('health-save'));
    await fireEvent.press(screen.getByTestId('health-save'));
    const expected = { pet_id: pet.id, type, title: 'Routine care', occurred_at: new Date(c.clock.now()).toISOString(),
      notes: null, next_due_on: null, attachment_asset_id: null };
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expected);
    expect(Object.values(c.store.getState().healthEvents)).toEqual([expect.objectContaining(expected)]);
    expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'POST', path: '/health-events', body: expected });
    expect(c.outbox.count()).toBe(1);
    expect(c.onClose).toHaveBeenCalledTimes(1);
    expect(c.http.requests).toEqual([]);
  },
);

test('R2.10 a family-local instant, date-only next due date, notes and returned photo save locally', async () => {
  const { c, pet } = await scene();
  const attachmentId = c.ids.uuid();
  await paint(c, <HealthFormScreen petId={pet.id} services={c} active attachmentAssetId={attachmentId}
    onClose={c.onClose} onAttachment={jest.fn()} />);
  await fireEvent.press(screen.getByRole('radio', { name: strings.health.types.vet_visit }));
  await fireEvent.changeText(screen.getByTestId('health-title'), 'Annual checkup');
  await fireEvent.changeText(screen.getByTestId('health-occurred-at'), '12/10/2026 23:15');
  await fireEvent.changeText(screen.getByTestId('health-next-due-on'), '12/11/2026');
  await fireEvent.changeText(screen.getByTestId('health-notes'), 'Bring previous results');
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'POST', path: '/health-events', body: {
    pet_id: pet.id, type: 'vet_visit', title: 'Annual checkup', occurred_at: '2026-10-13T02:15:00.000Z',
    next_due_on: '2026-11-12', notes: 'Bring previous results', attachment_asset_id: attachmentId,
  } });
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test.each([
  ['health-occurred-at', '', 'occurred_at', 'required'],
  ['health-occurred-at', '31/02/2026 12:00', 'occurred_at', 'invalid'],
  ['health-next-due-on', '31/02/2026', 'next_due_on', 'invalid'],
  ['health-next-due-on', '29/02/2027', 'next_due_on', 'invalid'],
  ['health-next-due-on', '2026-11-12', 'next_due_on', 'invalid'],
] as const)('R2.10 %s refuses invalid input "%s" before a mutation', async (id, value, field, code) => {
  const { c, pet } = await scene();
  await paint(c, form(c, pet.id));
  await fireEvent.press(screen.getByRole('radio', { name: strings.health.types.vaccine }));
  await fireEvent.changeText(screen.getByTestId('health-title'), 'Routine care');
  await fireEvent.changeText(screen.getByTestId(id), value);
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(screen.getByRole('alert')).toHaveTextContent(formatValidationError({ field, code }));
  expect(c.store.getState().healthEvents).toEqual({});
  expect(c.outbox.count()).toBe(0);
  expect(c.onClose).not.toHaveBeenCalled();
  expect(c.http.requests).toEqual([]);
});

test('R2.10 editing preloads every field, clears optional dates and notes, and preserves the photo once', async () => {
  const { c, pet } = await scene();
  const event = c.factory.health_events({ pet_id: pet.id, type: 'procedure', title: 'Original care',
    occurred_at: '2026-10-13T02:15:23.456Z', next_due_on: '2028-02-29', notes: 'Original notes', attachment_asset_id: c.ids.uuid() });
  c.driver.transaction(() => { c.apply.applyLocalRow('health_events', event); });
  const patch = jest.spyOn(c.mutations, 'patchHealthEvent');
  await paint(c, <HealthDetailScreen eventId={event.id} services={c} active onClose={c.onClose} onAttachment={jest.fn()} />);
  expect(screen.getByRole('radio', { name: strings.health.types.procedure })).toBeChecked();
  expect(screen.getByTestId('health-title')).toHaveDisplayValue(event.title);
  expect(screen.getByTestId('health-occurred-at')).toHaveDisplayValue('12/10/2026 23:15');
  expect(screen.getByTestId('health-next-due-on')).toHaveDisplayValue(formatFullDate('2028-02-29'));
  expect(screen.getByTestId('health-notes')).toHaveDisplayValue(event.notes ?? '');
  await fireEvent.changeText(screen.getByTestId('health-title'), 'Updated care');
  await fireEvent.changeText(screen.getByTestId('health-next-due-on'), '');
  await fireEvent.changeText(screen.getByTestId('health-notes'), '');
  await fireEvent.press(screen.getByTestId('health-save'));
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith(event.id, { type: 'procedure', title: 'Updated care',
    occurred_at: event.occurred_at, next_due_on: null, notes: null, attachment_asset_id: event.attachment_asset_id });
  expect(c.outbox.count()).toBe(1);
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});
