import type { DateKey, HealthEvent } from '@pawlaris/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AssetFilesProvider } from '../../../assets/useAssetFile';
import { deferred, response } from '../../../auth/__tests__/support';
import { strings } from '../../../i18n/strings';
import { formatFullDate, formatMonth } from '../../../i18n/format';
import type { HttpResponse } from '../../../platform/http';
import { ReplicaProvider } from '../../../replica/useReplica';
import * as ReduceMotion from '../../../ui/motion/useReduceMotion';
import { petContext, type PetContext } from '../../pets/__tests__/support';
import { PetProfileScreen } from '../../pets/PetProfileScreen';
import { HealthDetailScreen } from '../HealthDetailScreen';
import { HealthFormScreen } from '../HealthFormScreen';
import { HealthTimelineItem } from '../HealthTimelineItem';
import { HealthTimelineSection } from '../HealthTimelineSection';

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
  return c;
}

function seedEvent(c: PetContext, overrides: Partial<HealthEvent> = {}): HealthEvent {
  const event = c.factory.health_events(overrides);
  c.driver.transaction(() => { c.apply.applyLocalRow('health_events', event); });
  return event;
}

async function paint(c: PetContext, children: ReactNode) {
  return render(<ReplicaProvider store={c.store}>
    <AssetFilesProvider files={c.files}>{children}</AssetFilesProvider>
  </ReplicaProvider>);
}

function item(event: HealthEvent) {
  return <HealthTimelineItem event={event} timezone="America/Sao_Paulo" active onOpen={jest.fn()} />;
}

test('R2.12 the timeline reads live replica rows for its pet, grouped newest first', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const other = c.seedPet({ name: 'Vega' });
  const october = seedEvent(c, { pet_id: pet.id, title: 'October care', occurred_at: '2026-11-01T02:59:00.000Z' });
  const november = seedEvent(c, { pet_id: pet.id, title: 'November care', occurred_at: '2026-11-01T03:00:00.000Z' });
  seedEvent(c, { pet_id: other.id, title: 'Other pet care' });
  seedEvent(c, { pet_id: pet.id, title: 'Deleted care', deleted_at: new Date(c.clock.now()).toISOString() });
  const onOpen = jest.fn();
  await paint(c, <HealthTimelineSection petId={pet.id} active onAdd={c.onAdd} onOpen={onOpen} />);
  expect(screen.getAllByTestId(/^health-month-/).map((row) => row.props.testID))
    .toEqual(['health-month-2026-11', 'health-month-2026-10']);
  expect(within(screen.getByTestId('health-month-2026-10')).getByText(october.title)).toBeOnTheScreen();
  expect(within(screen.getByTestId('health-month-2026-11')).getByText(november.title)).toBeOnTheScreen();
  expect(screen.queryByText('Other pet care')).toBeNull();
  expect(screen.queryByText('Deleted care')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  await fireEvent.press(screen.getByTestId(`health-event-${november.id}`));
  expect(onOpen).toHaveBeenCalledWith(november.id);
  await fireEvent.press(screen.getByTestId('health-add'));
  expect(c.onAdd).toHaveBeenCalledTimes(1);
  let added: HealthEvent | undefined;
  await act(() => { added = seedEvent(c, { pet_id: pet.id, title: 'Later care', occurred_at: '2026-11-02T12:00:00.000Z' }); });
  expect(screen.getAllByTestId(/^health-event-/).map((row) => row.props.testID))
    .toEqual([`health-event-${added?.id}`, `health-event-${november.id}`, `health-event-${october.id}`]);
  expect(c.http.requests).toEqual([]);
});

test('R2.12 the profile includes its health month, event glyph and local date with navigation actions', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const event = seedEvent(c, { pet_id: pet.id, occurred_at: '2026-11-01T02:59:00.000Z' });
  const onOpenHealth = jest.fn();
  await paint(c, <PetProfileScreen services={c.services} petId={pet.id} active
    onEdit={jest.fn()} onAddWeight={jest.fn()} onWalks={jest.fn()}
    onAddHealth={c.onAdd} onOpenHealth={onOpenHealth} />);
  const health = within(screen.getByTestId('pet-health'));
  expect(health.getByRole('header', { name: strings.health.heading })).toBeOnTheScreen();
  expect(health.getByRole('header', { name: formatMonth('2026-10') })).toBeOnTheScreen();
  expect(health.getByRole('image', { name: strings.health.types.vaccine })).toBeOnTheScreen();
  expect(health.getByText(formatFullDate('2026-10-31'))).toBeOnTheScreen();
  await fireEvent.press(health.getByTestId(`health-event-${event.id}`));
  expect(onOpenHealth).toHaveBeenCalledTimes(1);
  expect(onOpenHealth).toHaveBeenCalledWith(event.id);
  await fireEvent.press(health.getByTestId('health-add'));
  expect(c.onAdd).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test.each<{ due: DateKey | null; short: string | null }>([
  { due: '2026-11-12', short: '12/11' },
  { due: '2026-01-01', short: '01/01' },
  { due: null, short: null },
])('R2.10 next_due_on $due is a date-only short label when present', async ({ due, short }) => {
  const c = await scene();
  const event = seedEvent(c, { next_due_on: due });
  await paint(c, item(event));
  expect(screen.getByText(event.title)).toBeOnTheScreen();
  if (short === null) expect(screen.queryByText(new RegExp(`^${strings.health.nextDue('')}`))).toBeNull();
  else expect(screen.getByText(strings.health.nextDue(short))).toBeOnTheScreen();
  expect(c.http.requests).toEqual([]);
});

test.each(['queued', 'sent', 'refused'] as const)(
  'R3.46 a local attachment keeps its thumbnail with the honest %s upload label', async (state) => {
    const c = await scene();
    const id = c.ids.uuid();
    const uri = `file:///fake/documents/assets/${id}.jpg`;
    c.fileSystem.write(uri, new Uint8Array([1, 2, 3]));
    const pending = deferred<HttpResponse>();
    c.fileSystem.enqueue(state === 'queued' ? () => pending.promise : response(state === 'sent' ? 201 : 422));
    c.files.registerCapture({ id, kind: 'health_attachment', localUri: uri, sha256: 'a'.repeat(64) });
    if (state !== 'queued') await c.files.uploads.kick();
    const event = seedEvent(c, { attachment_asset_id: id });
    await paint(c, item(event));
    // Expo Image normalizes a single source to a native source array.
    expect(screen.getByRole('image', { name: strings.pets.photo })).toHaveProp('source', [{ uri }]);
    const expected = state === 'queued' ? strings.health.photoUploading : state === 'refused' ? strings.health.photoFailed : null;
    for (const label of [strings.health.photoUploading, strings.health.photoFailed, strings.health.photoPending]) {
      if (label === expected) expect(screen.getByText(label)).toBeOnTheScreen();
      else expect(screen.queryByText(label)).toBeNull();
    }
    if (state === 'refused') {
      const retry = jest.spyOn(c.files, 'retryUpload');
      c.fileSystem.enqueue(response(201));
      await fireEvent.press(screen.getByTestId('photo-retry'));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledWith(id);
    }
    await act(async () => {
      pending.resolve(response(201));
      await c.files.uploads.kick();
    });
    expect(screen.queryByText(strings.health.photoUploading)).toBeNull();
    expect(screen.queryByText(strings.health.photoFailed)).toBeNull();
    expect(screen.queryByTestId('photo-retry')).toBeNull();
    expect(c.http.requests).toEqual([]);
  },
);

test('R3.46 the receiving phone shows a pending attachment until its asset arrives', async () => {
  const c = await scene();
  const id = c.ids.uuid();
  const event = seedEvent(c, { attachment_asset_id: id });
  await paint(c, item(event));
  expect(screen.getByText(strings.health.photoPending)).toBeOnTheScreen();
  expect(screen.queryByRole('image', { name: strings.pets.photo })).toBeNull();
  expect(c.fileSystem.requests).toEqual([]);
  c.fileSystem.enqueue(response(200));
  await act(() => {
    c.apply.applyServerRows([{ entity: 'assets', row: c.factory.assets({ id, kind: 'health_attachment' }) }]);
  });
  expect(screen.getByRole('image', { name: strings.pets.photo })).toBeOnTheScreen();
  expect(screen.queryByText(strings.health.photoPending)).toBeNull();
  expect(screen.queryByText(strings.health.photoUploading)).toBeNull();
  expect(screen.queryByText(strings.health.photoFailed)).toBeNull();
  expect(c.http.requests).toEqual([]);
});

test('R2.10 an event without an attachment has no thumbnail or transfer label', async () => {
  const c = await scene();
  await paint(c, item(seedEvent(c)));
  expect(screen.queryByRole('image', { name: strings.pets.photo })).toBeNull();
  for (const label of [strings.health.photoPending, strings.health.photoUploading, strings.health.photoFailed]) {
    expect(screen.queryByText(label)).toBeNull();
  }
  expect(c.fileSystem.requests).toEqual([]);
});

test('R2.10 editing saves the same event through patchHealthEvent without creating another', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const event = seedEvent(c, { pet_id: pet.id, title: 'Original title', notes: 'Existing notes',
    next_due_on: '2026-11-12', attachment_asset_id: c.ids.uuid() });
  const patch = jest.spyOn(c.mutations, 'patchHealthEvent');
  const create = jest.spyOn(c.mutations, 'createHealthEvent');
  const remove = jest.spyOn(c.mutations, 'deleteHealthEvent');
  await paint(c, <HealthDetailScreen eventId={event.id} services={c} active
    onClose={c.onClose} onAttachment={jest.fn()} />);
  expect(screen.getByLabelText(strings.health.title)).toHaveDisplayValue(event.title);
  await fireEvent.changeText(screen.getByLabelText(strings.health.title), 'Updated title');
  await fireEvent.press(screen.getByTestId('health-save'));
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith(event.id, expect.objectContaining({ title: 'Updated title' }));
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(Object.values(c.store.getState().healthEvents)).toEqual([
    expect.objectContaining({ ...event, title: 'Updated title' }),
  ]);
  expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'PATCH', path: `/health-events/${event.id}` });
  expect(c.outbox.count()).toBe(1);
  expect(c.onClose).toHaveBeenCalledTimes(1);
  expect(c.http.requests).toEqual([]);
});

test.each(['confirm', 'dismiss'] as const)('R2.10 deletion waits for its sheet decision: %s', async (decision) => {
  const c = await scene();
  const pet = c.seedPet();
  const event = seedEvent(c, { pet_id: pet.id });
  const other = seedEvent(c, { pet_id: pet.id });
  const remove = jest.spyOn(c.mutations, 'deleteHealthEvent');
  const patch = jest.spyOn(c.mutations, 'patchHealthEvent');
  const create = jest.spyOn(c.mutations, 'createHealthEvent');
  await paint(c, <HealthDetailScreen eventId={event.id} services={c} active
    onClose={c.onClose} onAttachment={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('health-delete'));
  const sheet = screen.getByRole('dialog', { name: strings.health.deleteConfirmation });
  expect(within(sheet).getByText(strings.health.deleteConfirmation)).toBeOnTheScreen();
  expect(remove).not.toHaveBeenCalled();
  expect(c.store.getState().healthEvents[event.id]).toEqual(event);
  expect(c.outbox.count()).toBe(0);
  expect(c.onClose).not.toHaveBeenCalled();
  await fireEvent.press(decision === 'confirm'
    ? within(sheet).getByTestId('health-delete-confirm')
    : within(sheet).getByRole('button', { name: strings.dismiss }));
  await act(async () => { await jest.advanceTimersByTimeAsync(200); });
  if (decision === 'confirm') {
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(event.id);
    expect(c.store.getState().healthEvents[event.id]).toBeUndefined();
    expect(c.outbox.head(c.sessionUser.id)).toMatchObject({ method: 'DELETE', path: `/health-events/${event.id}` });
    expect(c.outbox.count()).toBe(1);
    expect(c.onClose).toHaveBeenCalledTimes(1);
  } else {
    expect(remove).not.toHaveBeenCalled();
    expect(c.store.getState().healthEvents[event.id]).toEqual(event);
    expect(c.outbox.count()).toBe(0);
    expect(c.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  }
  expect(patch).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(c.store.getState().healthEvents[other.id]).toEqual(other);
  expect(c.http.requests).toEqual([]);
});

test('R2.10 the new health form opens the camera in attachment mode', async () => {
  const c = await scene();
  const pet = c.seedPet();
  const onAttachment = jest.fn();
  await paint(c, <HealthFormScreen petId={pet.id} services={c} active
    onClose={c.onClose} onAttachment={onAttachment} />);
  await fireEvent.press(screen.getByRole('button', { name: strings.pets.photo }));
  expect(onAttachment).toHaveBeenCalledTimes(1);
  expect(onAttachment).toHaveBeenCalledWith('attachment');
  expect(c.outbox.count()).toBe(0);
  expect(c.http.requests).toEqual([]);
});
