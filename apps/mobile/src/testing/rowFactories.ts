import type {
  Asset, Completion, Family, HealthEvent, Member, Pet, TaskTemplate,
  Timer, Walk, WeightEntry,
} from '@pawlaris/shared';
import type { AssetFile } from '../db/assetRepo';
import type { DeadLetterEntry } from '../db/deadLetterRepo';
import type { NewOutboxEntry } from '../db/outboxRepo';
import type { LocalWalk, WalkPoint } from '../db/walkRepo';
import { identity } from '../ui/tokens/color';

export function rowFactories(clock: { now(): number }, ids: { uuid(): string }) {
  const base = () => ({
    id: ids.uuid(), revision: 1, updated_at: new Date(clock.now()).toISOString(),
  });
  const deleted = () => ({ ...base(), deleted_at: null });
  const memberId = ids.uuid();
  const petId = ids.uuid();
  const taskId = ids.uuid();
  return {
    memberId, petId, taskId,
    members: (overrides: Partial<Member> = {}): Member => ({
      ...deleted(), display_name: 'Hudson', role: 'leader',
      color: identity[0].key, disabled_at: null, ...overrides,
    }),
    family: (overrides: Partial<Family> = {}): Family => ({
      ...deleted(), name: 'Our family', timezone: 'America/Sao_Paulo', ...overrides,
    }),
    pets: (overrides: Partial<Pet> = {}): Pet => ({
      ...deleted(), name: 'Aurora', species: 'cat', sex: 'female', breed: null,
      color: null, identity_color: null, birthdate: null, microchip_id: null, avatar_asset_id: null,
      notes: null, sort_order: 0, archived_at: null, created_by: memberId, ...overrides,
    }),
    task_templates: (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
      ...deleted(), title: 'Feed Aurora', description: null, category: 'feeding',
      assigned_to: null, requires_photo: false, timer_seconds: null,
      reminder_class: 'routine', sort_order: 0, recurrence: { freq: 'daily', interval: 1 },
      times_of_day: ['08:00'], starts_on: '2026-10-13', pet_ids: [petId],
      completion_mode: 'together', ends_on: null, replaces_task_id: null,
      created_by: memberId, ...overrides,
    }),
    weight_entries: (overrides: Partial<WeightEntry> = {}): WeightEntry => ({
      ...deleted(), pet_id: petId, weight_kg: 4.25,
      measured_at: new Date(clock.now()).toISOString(), note: null,
      created_by: memberId, ...overrides,
    }),
    health_events: (overrides: Partial<HealthEvent> = {}): HealthEvent => ({
      ...deleted(), pet_id: petId, type: 'vaccine', title: 'Vaccine',
      notes: null, occurred_at: new Date(clock.now()).toISOString(),
      next_due_on: null, attachment_asset_id: null, created_by: memberId, ...overrides,
    }),
    task_completions: (overrides: Partial<Completion> = {}): Completion => ({
      ...base(), task_id: taskId, occurrence_key: '2026-10-13T08:00', pet_id: null,
      completed_by: memberId, completed_at: new Date(clock.now()).toISOString(),
      title_snapshot: 'Feed Aurora', photo_asset_id: null, note: null,
      undone_at: null, undone_by: null, duplicate_of: null, ...overrides,
    }),
    task_timers: (overrides: Partial<Timer> = {}): Timer => ({
      ...base(), task_id: taskId, occurrence_key: '2026-10-13T08:00', pet_id: null,
      started_by: memberId, started_at: new Date(clock.now()).toISOString(),
      ends_at: new Date(clock.now() + 60_000).toISOString(), cancelled_at: null, ...overrides,
    }),
    walk_sessions: (overrides: Partial<Walk> = {}): Walk => ({
      ...deleted(), pet_id: petId, user_id: memberId, status: 'active',
      started_at: new Date(clock.now()).toISOString(), ended_at: null, paused_ms: 0,
      distance_m: 0, duration_s: 0, avg_pace_s_per_km: null, point_count: 0,
      has_route: false, preview: [], note: null, ...overrides,
    }),
    assets: (overrides: Partial<Asset> = {}): Asset => ({
      ...deleted(), kind: 'task_proof', mime: 'image/jpeg', bytes: 128,
      width: 32, height: 32, uploaded_by: memberId,
      created_at: new Date(clock.now()).toISOString(), ...overrides,
    }),
    outbox: (overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry => ({
      clientMutationId: ids.uuid(), userId: memberId, method: 'POST', path: '/pets',
      body: { id: petId, name: 'Aurora', species: 'cat' }, entity: 'pets',
      entityId: petId, createdAt: clock.now(), ...overrides,
    }),
    deadLetter: (overrides: Partial<DeadLetterEntry> = {}): DeadLetterEntry => ({
      clientMutationId: ids.uuid(), method: 'PATCH', path: `/pets/${petId}`,
      body: { name: 'Aurora' }, status: 422, error: 'validation_error',
      createdAt: clock.now(), failedAt: clock.now(), ...overrides,
    }),
    assetFile: (overrides: Partial<AssetFile> = {}): AssetFile => ({
      id: ids.uuid(), kind: 'task_proof', localUri: 'file:///assets/proof.jpg',
      state: 'to_upload', sha256: 'a'.repeat(64), attempts: 0, nextRetryAt: 0,
      createdAt: clock.now(), ...overrides,
    }),
    localWalk: (overrides: Partial<LocalWalk> = {}): LocalWalk => ({
      id: ids.uuid(), petId, state: 'active', startedAt: clock.now(), pausedMs: 0,
      pauseStartedAt: null, trackingMode: 'service', ...overrides,
    }),
    walkPoint: (overrides: Partial<WalkPoint> = {}): WalkPoint => ({
      walkId: ids.uuid(), seq: 0, lat: -23.55, lon: -46.63, t: clock.now(),
      acc: 8, paused: false, ...overrides,
    }),
  };
}
